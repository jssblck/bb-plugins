import type { BbPluginApi } from "@bb/plugin-sdk";

import { listDesktopAccounts } from "./accounts.ts";
import { denyMessage, modeAllows, resolveGrantMode } from "./acl.ts";
import { upsertDotenv } from "./dotenv.ts";
import { OnePasswordError } from "./errors.ts";
import {
  resolveHostPath,
  resolveThreadHost,
  writeHostFile,
} from "./files.ts";
import {
  GRANT_REQUEST_RENDERER,
  parseGrantRequestResponse,
} from "./grant-request.ts";
import {
  listItems,
  listVaults,
  readField,
  resolveItem,
  writeField,
  type ItemSummary,
  type VaultSummary,
} from "./onepassword.ts";
import { KEEP_ALIVE_MS, SessionManager } from "./session.ts";
import { GrantStore } from "./store.ts";
import { CHANGE_CHANNEL, type Grant, type GrantMode, type SecretRef } from "./types.ts";

export class OnePasswordService {
  readonly store: GrantStore;
  readonly session = new SessionManager();

  constructor(private readonly bb: BbPluginApi) {
    this.store = new GrantStore(bb);
  }

  publish(): void {
    this.bb.realtime.publish(CHANGE_CHANNEL, { at: Date.now() });
  }

  async listAccounts() {
    const accounts = await listDesktopAccounts();
    return {
      accounts,
      unlockedAccountIds: this.session.unlockedAccountIds(),
    };
  }

  async listProjects() {
    const projects = await this.bb.sdk.projects.list({ includePersonal: true });
    return projects.map((project) => ({ id: project.id, name: project.name }));
  }

  async unlock(accountId: string): Promise<void> {
    const accounts = await listDesktopAccounts();
    const account = accounts.find((entry) => entry.id === accountId);
    await this.session.unlock(
      accountId,
      account === undefined ? [] : [account.url, account.email],
    );
    this.store.writeAudit({
      projectId: null,
      threadId: null,
      accountId,
      vaultId: null,
      vaultTitle: null,
      itemId: null,
      itemTitle: null,
      fieldId: null,
      fieldTitle: null,
      action: "unlock",
      mode: null,
      detail: null,
    });
    this.publish();
  }

  lock(accountId: string): void {
    this.session.lock(accountId);
    this.store.writeAudit({
      projectId: null,
      threadId: null,
      accountId,
      vaultId: null,
      vaultTitle: null,
      itemId: null,
      itemTitle: null,
      fieldId: null,
      fieldTitle: null,
      action: "lock",
      mode: null,
      detail: null,
    });
    this.publish();
  }

  async listVaultsFor(accountId: string): Promise<VaultSummary[]> {
    return listVaults(this.session.require(accountId));
  }

  async listItemsFor(
    accountId: string,
    vaultId: string,
  ): Promise<ItemSummary[]> {
    return listItems(this.session.require(accountId), vaultId);
  }

  setGrant(args: {
    projectId: string;
    accountId: string;
    targetKind: "item" | "vault";
    vaultId: string;
    vaultTitle: string;
    itemId: string | null;
    itemTitle: string | null;
    mode: GrantMode | null;
  }): Grant | null {
    const grant = this.store.setGrant(args);
    this.publish();
    return grant;
  }

  async resolveAccountId(needle: string): Promise<string> {
    const { accounts } = await this.listAccounts();
    const match = accounts.find(
      (account) =>
        account.id === needle ||
        account.url === needle ||
        account.email === needle,
    );
    if (match === undefined) {
      throw new OnePasswordError(`No 1Password account matches ${needle}.`);
    }
    return match.id;
  }

  async ensureAccount(explicit: string | null): Promise<string> {
    if (explicit !== null) {
      const accountId = await this.resolveAccountId(explicit);
      if (!this.session.isUnlocked(accountId)) await this.unlock(accountId);
      return accountId;
    }
    const unlocked = this.session.unlockedAccountIds();
    const firstUnlocked = unlocked[0];
    if (unlocked.length === 1 && firstUnlocked !== undefined) {
      return firstUnlocked;
    }
    if (unlocked.length > 1) {
      throw new OnePasswordError(
        `More than one account is unlocked (${unlocked.length}). Pass --account <id>.`,
      );
    }
    const { accounts } = await this.listAccounts();
    const only = accounts[0];
    if (accounts.length === 1 && only !== undefined) {
      await this.unlock(only.id);
      return only.id;
    }
    throw new OnePasswordError(
      "Pass --account <id|url|email>. This Mac has more than one 1Password account.",
    );
  }

  async chooseAccount(explicit: string | null): Promise<string> {
    if (explicit !== null) {
      const accountId = await this.resolveAccountId(explicit);
      this.session.require(accountId);
      return accountId;
    }
    const unlocked = this.session.unlockedAccountIds();
    const first = unlocked[0];
    if (unlocked.length === 1 && first !== undefined) return first;
    if (unlocked.length === 0) {
      throw new OnePasswordError(
        "1Password is locked. Unlock it in the 1Password panel, then retry.",
      );
    }
    throw new OnePasswordError(
      `More than one account is unlocked (${unlocked.length}). Pass --account <id>.`,
    );
  }

  async requestAccess(args: {
    threadId: string;
    signal?: AbortSignal;
    accountId: string | null;
    ref: SecretRef;
    mode: GrantMode;
    purpose: string | null;
  }): Promise<{
    already: boolean;
    mode: GrantMode;
    vaultTitle: string;
    itemTitle: string;
  }> {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.ensureAccount(args.accountId);
    const { vault, overview } = await resolveItem(
      this.session.require(accountId),
      args.ref,
    );
    const have = resolveGrantMode(this.store.listGrants(host.projectId), {
      projectId: host.projectId,
      accountId,
      vaultId: vault.id,
      itemId: overview.id,
    });
    if (modeAllows(have, args.mode)) {
      return {
        already: true,
        mode: have ?? args.mode,
        vaultTitle: vault.title,
        itemTitle: overview.title,
      };
    }
    const accounts = await this.listAccounts();
    const account = accounts.accounts.find((entry) => entry.id === accountId);
    const result = await this.bb.ui.requestInput(
      {
        threadId: args.threadId,
        rendererId: GRANT_REQUEST_RENDERER,
        title: `Allow ${args.mode} on ${overview.title}`,
        payload: {
          purpose: args.purpose,
          mode: args.mode,
          vaultTitle: vault.title,
          itemTitle: overview.title,
          accountLabel: account?.email ?? accountId,
        },
      },
      { signal: args.signal },
    );
    if (result.outcome === "cancelled") {
      throw new OnePasswordError(
        `Access request cancelled (${result.reason}).`,
      );
    }
    const response = parseGrantRequestResponse(result.value);
    if (response === null || !response.approved) {
      throw new OnePasswordError(
        `Access to "${overview.title}" was denied.`,
      );
    }
    this.setGrant({
      projectId: host.projectId,
      accountId,
      targetKind: "item",
      vaultId: vault.id,
      vaultTitle: vault.title,
      itemId: overview.id,
      itemTitle: overview.title,
      mode: args.mode,
    });
    return {
      already: false,
      mode: args.mode,
      vaultTitle: vault.title,
      itemTitle: overview.title,
    };
  }

  async authorize(args: {
    projectId: string;
    threadId: string | null;
    accountId: string;
    ref: SecretRef;
    need: GrantMode;
  }) {
    const client = this.session.require(args.accountId);
    let resolved: Awaited<ReturnType<typeof readField>>;
    try {
      resolved = await readField(client, args.ref);
    } catch (error) {
      if (error instanceof OnePasswordError) {
        this.store.writeAudit({
          projectId: args.projectId,
          threadId: args.threadId,
          accountId: args.accountId,
          vaultId: null,
          vaultTitle: null,
          itemId: null,
          itemTitle: null,
          fieldId: null,
          fieldTitle: null,
          action: "deny",
          mode: args.need,
          detail: error.message,
        });
      }
      throw error;
    }
    const have = resolveGrantMode(this.store.listGrants(args.projectId), {
      projectId: args.projectId,
      accountId: args.accountId,
      vaultId: resolved.vault.id,
      itemId: resolved.item.id,
    });
    if (!modeAllows(have, args.need)) {
      const detail = denyMessage({
        itemTitle: resolved.item.title,
        need: args.need,
      });
      this.store.writeAudit({
        projectId: args.projectId,
        threadId: args.threadId,
        accountId: args.accountId,
        vaultId: resolved.vault.id,
        vaultTitle: resolved.vault.title,
        itemId: resolved.item.id,
        itemTitle: resolved.item.title,
        fieldId: resolved.fieldId,
        fieldTitle: resolved.fieldTitle,
        action: "deny",
        mode: args.need,
        detail,
      });
      throw new OnePasswordError(detail);
    }
    return { ...resolved, mode: have };
  }

  recordAccess(args: {
    projectId: string;
    threadId: string | null;
    accountId: string;
    vaultId: string;
    vaultTitle: string;
    itemId: string;
    itemTitle: string;
    fieldId: string;
    fieldTitle: string;
    action: "read" | "write";
    mode: GrantMode | null;
  }): void {
    this.store.writeAudit({
      ...args,
      detail: null,
    });
  }

  async inject(args: {
    threadId: string;
    cwd: string | undefined;
    writeEnv: string;
    accountId: string | null;
    assignments: Array<{ name: string; ref: SecretRef }>;
  }): Promise<{
    path: string;
    added: string[];
    updated: string[];
    unchanged: string[];
  }> {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.chooseAccount(args.accountId);
    const values: Record<string, string> = {};
    for (const assignment of args.assignments) {
      const field = await this.authorize({
        projectId: host.projectId,
        threadId: args.threadId,
        accountId,
        ref: assignment.ref,
        need: "read",
      });
      values[assignment.name] = field.value;
      this.recordAccess({
        projectId: host.projectId,
        threadId: args.threadId,
        accountId,
        vaultId: field.vault.id,
        vaultTitle: field.vault.title,
        itemId: field.item.id,
        itemTitle: field.item.title,
        fieldId: field.fieldId,
        fieldTitle: field.fieldTitle,
        action: "read",
        mode: field.mode,
      });
    }
    const path = resolveHostPath(args.cwd, args.writeEnv);
    const existing = await this.bb.sdk.files
      .read({ hostId: host.hostId, path })
      .catch(() => ({ content: "" }));
    const reconciled = upsertDotenv(existing.content, values);
    await writeHostFile(this.bb, {
      hostId: host.hostId,
      path,
      content: reconciled.content,
    });
    return {
      path,
      added: reconciled.added,
      updated: reconciled.updated,
      unchanged: reconciled.unchanged,
    };
  }

  async writeFieldToFile(args: {
    threadId: string;
    cwd: string | undefined;
    accountId: string | null;
    ref: SecretRef;
    dest: { kind: "dotenv"; path: string; name: string } | { kind: "file"; path: string };
  }): Promise<{ path: string; name?: string }> {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.chooseAccount(args.accountId);
    const field = await this.authorize({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      ref: args.ref,
      need: "read",
    });
    const path = resolveHostPath(args.cwd, args.dest.path);
    if (args.dest.kind === "dotenv") {
      const existing = await this.bb.sdk.files
        .read({ hostId: host.hostId, path })
        .catch(() => ({ content: "" }));
      const reconciled = upsertDotenv(existing.content, {
        [args.dest.name]: field.value,
      });
      await writeHostFile(this.bb, {
        hostId: host.hostId,
        path,
        content: reconciled.content,
      });
    } else {
      await writeHostFile(this.bb, {
        hostId: host.hostId,
        path,
        content: field.value,
      });
    }
    this.recordAccess({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      vaultId: field.vault.id,
      vaultTitle: field.vault.title,
      itemId: field.item.id,
      itemTitle: field.item.title,
      fieldId: field.fieldId,
      fieldTitle: field.fieldTitle,
      action: "read",
      mode: field.mode,
    });
    return args.dest.kind === "dotenv"
      ? { path, name: args.dest.name }
      : { path };
  }

  async printField(args: {
    threadId: string;
    accountId: string | null;
    ref: SecretRef;
  }): Promise<string> {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.chooseAccount(args.accountId);
    const field = await this.authorize({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      ref: args.ref,
      need: "read",
    });
    this.recordAccess({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      vaultId: field.vault.id,
      vaultTitle: field.vault.title,
      itemId: field.item.id,
      itemTitle: field.item.title,
      fieldId: field.fieldId,
      fieldTitle: field.fieldTitle,
      action: "read",
      mode: field.mode,
    });
    return field.value;
  }

  async readHostText(args: {
    threadId: string;
    cwd: string | undefined;
    path: string;
  }): Promise<string> {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const path = resolveHostPath(args.cwd, args.path);
    const file = await this.bb.sdk.files.read({
      hostId: host.hostId,
      path,
    });
    return file.content;
  }

  async writeGrantedField(args: {
    threadId: string;
    accountId: string | null;
    ref: SecretRef;
    value: string;
  }) {
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.chooseAccount(args.accountId);
    const authorized = await this.authorize({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      ref: args.ref,
      need: "readwrite",
    });
    const written = await writeField(
      this.session.require(accountId),
      args.ref,
      args.value,
    );
    this.recordAccess({
      projectId: host.projectId,
      threadId: args.threadId,
      accountId,
      vaultId: written.vault.id,
      vaultTitle: written.vault.title,
      itemId: written.item.id,
      itemTitle: written.item.title,
      fieldId: written.fieldId,
      fieldTitle: written.fieldTitle,
      action: "write",
      mode: authorized.mode,
    });
    return {
      vaultTitle: written.vault.title,
      itemTitle: written.item.title,
      fieldTitle: written.fieldTitle,
    };
  }

  async createLoginItem(args: {
    accountId: string;
    vaultId: string;
    title: string;
    password: string;
  }): Promise<{ itemId: string; vaultId: string; title: string }> {
    const item = await this.session.require(args.accountId).items.create({
      title: args.title,
      category: "Login",
      vaultId: args.vaultId,
      fields: [
        {
          id: "password",
          title: "password",
          fieldType: "Concealed",
          value: args.password,
        },
      ],
    });
    return { itemId: item.id, vaultId: item.vaultId, title: item.title };
  }

  async deleteItem(args: {
    accountId: string;
    vaultId: string;
    itemId: string;
  }): Promise<void> {
    await this.session.require(args.accountId).items.delete(args.vaultId, args.itemId);
  }

  async runSelfTest(args: {
    threadId: string;
    cwd: string | undefined;
    accountId: string | null;
  }): Promise<{ vault: string; item: string; path: string; matched: boolean }> {
    const TEST_VALUE = "bb-1p-self-test";
    const TEST_TITLE = "BB 1Password plugin test";
    const host = await resolveThreadHost(this.bb, args.threadId);
    const accountId = await this.chooseAccount(args.accountId);
    const vaults = await this.listVaultsFor(accountId);
    const vault =
      vaults.find((entry) => entry.title === "Personal") ?? vaults[0];
    if (vault === undefined) {
      throw new OnePasswordError("No vaults available for the self-test.");
    }
    const dest = resolveHostPath(args.cwd, ".bb-1p-self-test.env");
    const created = await this.createLoginItem({
      accountId,
      vaultId: vault.id,
      title: TEST_TITLE,
      password: TEST_VALUE,
    });
    this.setGrant({
      projectId: host.projectId,
      accountId,
      targetKind: "item",
      vaultId: created.vaultId,
      vaultTitle: vault.title,
      itemId: created.itemId,
      itemTitle: created.title,
      mode: "read",
    });
    try {
      const injected = await this.inject({
        threadId: args.threadId,
        cwd: args.cwd,
        writeEnv: dest,
        accountId,
        assignments: [
          {
            name: "BB_1P_TEST",
            ref: {
              vault: created.vaultId,
              item: created.itemId,
              section: null,
              field: "password",
            },
          },
        ],
      });
      const written = await this.readHostText({
        threadId: args.threadId,
        cwd: args.cwd,
        path: dest,
      });
      const matched = written.includes(`BB_1P_TEST=${TEST_VALUE}`);
      if (!matched) {
        throw new OnePasswordError("Self-test inject wrote unexpected contents.");
      }
      let writeDenied = false;
      try {
        await this.writeGrantedField({
          threadId: args.threadId,
          accountId,
          ref: {
            vault: created.vaultId,
            item: created.itemId,
            section: null,
            field: "password",
          },
          value: TEST_VALUE,
        });
      } catch {
        writeDenied = true;
      }
      if (!writeDenied) {
        throw new OnePasswordError(
          "Self-test expected a read-only grant to reject field set.",
        );
      }
      await this.bb.sdk.files.remove({
        hostId: host.hostId,
        path: dest,
      });
      return {
        vault: vault.title,
        item: created.title,
        path: injected.path,
        matched,
      };
    } finally {
      this.setGrant({
        projectId: host.projectId,
        accountId,
        targetKind: "item",
        vaultId: created.vaultId,
        vaultTitle: vault.title,
        itemId: created.itemId,
        itemTitle: created.title,
        mode: null,
      });
      await this.deleteItem({
        accountId,
        vaultId: created.vaultId,
        itemId: created.itemId,
      });
    }
  }

  async keepAliveOnce(): Promise<void> {
    const expired = await this.session.keepAlive();
    if (expired.length === 0) return;
    for (const accountId of expired) {
      this.store.writeAudit({
        projectId: null,
        threadId: null,
        accountId,
        vaultId: null,
        vaultTitle: null,
        itemId: null,
        itemTitle: null,
        fieldId: null,
        fieldTitle: null,
        action: "lock",
        mode: null,
        detail: "Desktop session expired.",
      });
    }
    this.publish();
  }
}

export { KEEP_ALIVE_MS };
