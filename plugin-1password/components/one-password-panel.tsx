import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useBbContext,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";

import type { rpcContract } from "../server";
import { CHANGE_CHANNEL } from "../src/types.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Account = { id: string; url: string; email: string };
type Project = { id: string; name: string };
type Vault = { id: string; title: string; itemCount: number };
type Item = { id: string; title: string; category: string; vaultId: string };
type Grant = {
  id: string;
  projectId: string;
  accountId: string;
  targetKind: "item" | "vault";
  vaultId: string;
  vaultTitle: string;
  itemId: string | null;
  itemTitle: string | null;
  mode: "read" | "readwrite";
};
type AuditRow = {
  id: string;
  at: number;
  action: "read" | "write" | "deny" | "unlock" | "lock";
  vaultTitle: string | null;
  itemTitle: string | null;
  fieldTitle: string | null;
  detail: string | null;
};

export function OnePasswordPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId: contextProjectId } = useBbContext();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(contextProjectId);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const unlockedSet = useMemo(() => new Set(unlocked), [unlocked]);
  const selectedUnlocked = accountId !== null && unlockedSet.has(accountId);

  const loadStatus = useCallback(async () => {
    const [status, projectList] = await Promise.all([
      rpc.call("status"),
      rpc.call("listProjects"),
    ]);
    setAccounts(status.accounts);
    setUnlocked(status.unlockedAccountIds);
    setProjects(projectList.projects);
    setAccountId((current) => {
      if (current !== null && status.accounts.some((account) => account.id === current)) {
        return current;
      }
      return status.accounts[0]?.id ?? null;
    });
    setProjectId((current) => {
      if (current !== null && projectList.projects.some((project) => project.id === current)) {
        return current;
      }
      if (
        contextProjectId !== null &&
        projectList.projects.some((project) => project.id === contextProjectId)
      ) {
        return contextProjectId;
      }
      return projectList.projects[0]?.id ?? null;
    });
  }, [contextProjectId, rpc]);

  const loadVaults = useCallback(async () => {
    if (accountId === null || !unlockedSet.has(accountId)) {
      setVaults([]);
      setItems([]);
      setVaultId(null);
      return;
    }
    const result = await rpc.call("listVaults", { accountId });
    setVaults(result.vaults);
    setVaultId((current) => {
      if (current !== null && result.vaults.some((vault) => vault.id === current)) {
        return current;
      }
      return result.vaults[0]?.id ?? null;
    });
  }, [accountId, rpc, unlockedSet]);

  const loadItems = useCallback(async () => {
    if (accountId === null || vaultId === null || !unlockedSet.has(accountId)) {
      setItems([]);
      return;
    }
    const result = await rpc.call("listItems", { accountId, vaultId });
    setItems(result.items);
  }, [accountId, rpc, unlockedSet, vaultId]);

  const loadGrants = useCallback(async () => {
    if (projectId === null) {
      setGrants([]);
      return;
    }
    const result = await rpc.call("listGrants", { projectId });
    setGrants(result.grants);
  }, [projectId, rpc]);

  const loadAudit = useCallback(async () => {
    const result = await rpc.call("listAudit", { limit: 20 });
    setAudit(result.rows);
  }, [rpc]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      await loadStatus();
      await loadGrants();
      await loadAudit();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [loadAudit, loadGrants, loadStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(CHANGE_CHANNEL, () => {
    void refresh();
  });

  useEffect(() => {
    void loadVaults().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, [loadVaults]);

  useEffect(() => {
    void loadItems().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, [loadItems]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    try {
      setError(null);
      await work();
    } catch (workError) {
      const message = workError instanceof Error ? workError.message : String(workError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const selectedVault = vaults.find((vault) => vault.id === vaultId) ?? null;
  const filteredItems = items.filter((item) =>
    query.trim() === ""
      ? true
      : item.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const vaultGrant = grants.find(
    (grant) =>
      grant.targetKind === "vault" &&
      grant.accountId === accountId &&
      grant.vaultId === vaultId,
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={accountId ?? ""}
          onChange={(event) => setAccountId(event.target.value || null)}
        >
          {accounts.length === 0 ? <option value="">No accounts</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.email} ({account.url})
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={projectId ?? ""}
          onChange={(event) => setProjectId(event.target.value || null)}
        >
          {projects.length === 0 ? <option value="">No project</option> : null}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {selectedUnlocked ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || accountId === null}
            onClick={() => {
              if (accountId === null) return;
              void run("lock", async () => {
                await rpc.call("lock", { accountId });
                await refresh();
                await loadVaults();
              });
            }}
          >
            Lock
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy !== null || accountId === null}
            onClick={() => {
              if (accountId === null) return;
              void run("unlock", async () => {
                await rpc.call("unlock", { accountId });
                await refresh();
                await loadVaults();
              });
            }}
          >
            {busy === "unlock" ? "Approve on this Mac…" : "Unlock"}
          </Button>
        )}
      </header>

      <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
        {selectedUnlocked
          ? "Unlocked. Agents in the selected project can use granted items without another 1Password prompt."
          : "Unlock to browse vaults. The 1Password prompt appears on this Mac."}
        {error !== null ? (
          <p className="text-destructive">{error}</p>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 border-t border-border md:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-border md:border-b-0 md:border-r">
          {vaults.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {selectedUnlocked ? "No vaults." : "Unlock to list vaults."}
            </p>
          ) : (
            vaults.map((vault) => (
              <button
                key={vault.id}
                type="button"
                className={`flex w-full items-start justify-between gap-2 px-4 py-2 text-left text-sm ${
                  vault.id === vaultId
                    ? "bg-state-active text-foreground"
                    : "hover:bg-state-hover"
                }`}
                onClick={() => setVaultId(vault.id)}
              >
                <span className="min-w-0 truncate">{vault.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {vault.itemCount}
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="flex min-h-0 flex-col">
          {selectedVault === null ? (
            <p className="p-4 text-sm text-muted-foreground">Select a vault.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedVault.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Vault grant applies to every item here, including new ones.
                  </p>
                </div>
                <GrantSelect
                  value={vaultGrant?.mode ?? null}
                  disabled={busy !== null || projectId === null || accountId === null}
                  onChange={(mode) => {
                    if (projectId === null || accountId === null) return;
                    void run("grant", async () => {
                      await rpc.call("setGrant", {
                        projectId,
                        accountId,
                        targetKind: "vault",
                        vaultId: selectedVault.id,
                        vaultTitle: selectedVault.title,
                        itemId: null,
                        itemTitle: null,
                        mode,
                      });
                      await loadGrants();
                    });
                  }}
                />
              </div>
              <div className="border-b border-border px-4 py-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter items"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredItems.map((item) => {
                  const grant = grants.find(
                    (entry) =>
                      entry.targetKind === "item" &&
                      entry.accountId === accountId &&
                      entry.vaultId === item.vaultId &&
                      entry.itemId === item.id,
                  );
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 border-b border-border px-4 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.category}
                          {grant === undefined && vaultGrant !== undefined
                            ? ` · via vault ${vaultGrant.mode}`
                            : ""}
                        </p>
                      </div>
                      <GrantSelect
                        value={grant?.mode ?? null}
                        disabled={
                          busy !== null || projectId === null || accountId === null
                        }
                        onChange={(mode) => {
                          if (projectId === null || accountId === null) return;
                          void run("grant", async () => {
                            await rpc.call("setGrant", {
                              projectId,
                              accountId,
                              targetKind: "item",
                              vaultId: item.vaultId,
                              vaultTitle: selectedVault.title,
                              itemId: item.id,
                              itemTitle: item.title,
                              mode,
                            });
                            await loadGrants();
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent access
        </p>
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {audit.slice(0, 8).map((row) => (
              <li key={row.id}>
                {new Date(row.at).toLocaleString()} · {row.action}
                {row.itemTitle !== null ? ` · ${row.itemTitle}` : ""}
                {row.fieldTitle !== null ? ` / ${row.fieldTitle}` : ""}
                {row.detail !== null ? ` · ${row.detail}` : ""}
              </li>
            ))}
          </ul>
        )}
      </footer>
    </div>
  );
}

function GrantSelect({
  value,
  disabled,
  onChange,
}: {
  value: "read" | "readwrite" | null;
  disabled: boolean;
  onChange: (mode: "read" | "readwrite" | null) => void;
}) {
  return (
    <select
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "read" || next === "readwrite") onChange(next);
        else onChange(null);
      }}
    >
      <option value="">No access</option>
      <option value="read">Read</option>
      <option value="readwrite">Read/write</option>
    </select>
  );
}
