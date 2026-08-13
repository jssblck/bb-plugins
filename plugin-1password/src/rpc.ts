import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

import type { OnePasswordService } from "./service.ts";

const accountSchema = z.object({
  id: z.string(),
  url: z.string(),
  email: z.string(),
});

const grantSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  accountId: z.string(),
  targetKind: z.enum(["item", "vault"]),
  vaultId: z.string(),
  vaultTitle: z.string(),
  itemId: z.string().nullable(),
  itemTitle: z.string().nullable(),
  mode: z.enum(["read", "readwrite"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const auditSchema = z.object({
  id: z.string(),
  at: z.number(),
  projectId: z.string().nullable(),
  threadId: z.string().nullable(),
  accountId: z.string(),
  vaultId: z.string().nullable(),
  vaultTitle: z.string().nullable(),
  itemId: z.string().nullable(),
  itemTitle: z.string().nullable(),
  fieldId: z.string().nullable(),
  fieldTitle: z.string().nullable(),
  action: z.enum(["read", "write", "deny", "unlock", "lock"]),
  mode: z.enum(["read", "readwrite"]).nullable(),
  detail: z.string().nullable(),
});

export const rpcContract = defineRpcContract({
  status: {
    input: z.null(),
    output: z.object({
      accounts: z.array(accountSchema),
      unlockedAccountIds: z.array(z.string()),
    }),
  },
  listProjects: {
    input: z.null(),
    output: z.object({
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
  unlock: {
    input: z.object({ accountId: z.string() }).strict(),
    output: z.null(),
  },
  lock: {
    input: z.object({ accountId: z.string() }).strict(),
    output: z.null(),
  },
  listVaults: {
    input: z.object({ accountId: z.string() }).strict(),
    output: z.object({
      vaults: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          itemCount: z.number().int(),
        }),
      ),
    }),
  },
  listItems: {
    input: z.object({ accountId: z.string(), vaultId: z.string() }).strict(),
    output: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          category: z.string(),
          vaultId: z.string(),
        }),
      ),
    }),
  },
  listGrants: {
    input: z.object({ projectId: z.string() }).strict(),
    output: z.object({ grants: z.array(grantSchema) }),
  },
  setGrant: {
    input: z
      .object({
        projectId: z.string(),
        accountId: z.string(),
        targetKind: z.enum(["item", "vault"]),
        vaultId: z.string(),
        vaultTitle: z.string(),
        itemId: z.string().nullable(),
        itemTitle: z.string().nullable(),
        mode: z.enum(["read", "readwrite"]).nullable(),
      })
      .strict(),
    output: z.object({ grant: grantSchema.nullable() }),
  },
  listAudit: {
    input: z.object({ limit: z.number().int().min(1).max(100) }).strict(),
    output: z.object({ rows: z.array(auditSchema) }),
  },
});

export function createRpcHandlers(service: OnePasswordService) {
  return {
    status: () => service.listAccounts(),
    listProjects: async () => ({ projects: await service.listProjects() }),
    unlock: async ({ accountId }: { accountId: string }) => {
      await service.unlock(accountId);
      return null;
    },
    lock: ({ accountId }: { accountId: string }) => {
      service.lock(accountId);
      return null;
    },
    listVaults: async ({ accountId }: { accountId: string }) => ({
      vaults: await service.listVaultsFor(accountId),
    }),
    listItems: async ({
      accountId,
      vaultId,
    }: {
      accountId: string;
      vaultId: string;
    }) => ({ items: await service.listItemsFor(accountId, vaultId) }),
    listGrants: ({ projectId }: { projectId: string }) => ({
      grants: service.store.listGrants(projectId),
    }),
    setGrant: (input: {
      projectId: string;
      accountId: string;
      targetKind: "item" | "vault";
      vaultId: string;
      vaultTitle: string;
      itemId: string | null;
      itemTitle: string | null;
      mode: "read" | "readwrite" | null;
    }) => ({ grant: service.setGrant(input) }),
    listAudit: ({ limit }: { limit: number }) => ({
      rows: service.store.listAudit(limit),
    }),
  };
}
