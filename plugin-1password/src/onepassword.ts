import { errorMessage, OnePasswordError } from "./errors.ts";
import { fieldMatches, isNotesField } from "./refs.ts";
import type {
  SdkClient,
  SdkItem,
  SdkItemField,
  SdkItemOverview,
  SdkVaultOverview,
} from "./sdk.ts";
import type { SecretRef } from "./types.ts";

export interface VaultSummary {
  id: string;
  title: string;
  itemCount: number;
}

export interface ItemSummary {
  id: string;
  title: string;
  category: string;
  vaultId: string;
}

export async function listVaults(client: SdkClient): Promise<VaultSummary[]> {
  const vaults = await collect(client.vaults.list({ decryptDetails: true }));
  return vaults.map((vault) => ({
    id: vault.id,
    title: vault.title,
    itemCount: vault.activeItemCount,
  }));
}

export async function listItems(
  client: SdkClient,
  vaultId: string,
): Promise<ItemSummary[]> {
  const items = await collect(client.items.list(vaultId));
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    category: String(item.category),
    vaultId: item.vaultId,
  }));
}

export async function resolveItem(
  client: SdkClient,
  ref: SecretRef,
): Promise<{ vault: SdkVaultOverview; overview: SdkItemOverview }> {
  const vaults = await collect(client.vaults.list({ decryptDetails: true }));
  const vault = pickNamed(
    vaults,
    ref.vault,
    (entry) => entry.id,
    (entry) => entry.title,
    "vault",
  );
  const items = await collect(client.items.list(vault.id));
  const overview = pickNamed(
    items,
    ref.item,
    (entry) => entry.id,
    (entry) => entry.title,
    "item",
  );
  return { vault, overview };
}

export async function readField(
  client: SdkClient,
  ref: SecretRef,
): Promise<{
  vault: SdkVaultOverview;
  item: SdkItem;
  fieldId: string;
  fieldTitle: string;
  value: string;
}> {
  const { vault, overview } = await resolveItem(client, ref);
  let item: SdkItem;
  try {
    item = await client.items.get(vault.id, overview.id);
  } catch (error) {
    throw new OnePasswordError(
      `Could not read "${overview.title}": ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (isNotesField(ref)) {
    return {
      vault,
      item,
      fieldId: "notes",
      fieldTitle: "notes",
      value: item.notes,
    };
  }
  const field = findField(item, ref);
  return {
    vault,
    item,
    fieldId: field.id,
    fieldTitle: field.title,
    value: fieldValue(field),
  };
}

export async function writeField(
  client: SdkClient,
  ref: SecretRef,
  value: string,
): Promise<{
  vault: SdkVaultOverview;
  item: SdkItem;
  fieldId: string;
  fieldTitle: string;
}> {
  const current = await readField(client, ref);
  const nextItem: SdkItem = isNotesField(ref)
    ? { ...current.item, notes: value }
    : {
        ...current.item,
        fields: current.item.fields.map((field) =>
          field.id === current.fieldId ? { ...field, value } : field,
        ),
      };
  try {
    await client.items.put(nextItem);
  } catch (error) {
    throw new OnePasswordError(
      `Could not update "${current.item.title}": ${errorMessage(error)}`,
      { cause: error },
    );
  }
  return {
    vault: current.vault,
    item: current.item,
    fieldId: current.fieldId,
    fieldTitle: current.fieldTitle,
  };
}

function findField(item: SdkItem, ref: SecretRef): SdkItemField {
  const matches = item.fields.filter((field) =>
    fieldMatches(field, item.sections, ref),
  );
  if (matches.length === 0) {
    throw new OnePasswordError(
      `No field "${ref.field}" on "${item.title}".`,
    );
  }
  if (matches.length > 1) {
    throw new OnePasswordError(
      `More than one field named "${ref.field}" on "${item.title}". Use the field id.`,
    );
  }
  const field = matches[0];
  if (field === undefined) {
    throw new OnePasswordError(`No field "${ref.field}" on "${item.title}".`);
  }
  return field;
}

function fieldValue(field: SdkItemField): string {
  if (field.fieldType === "Totp" && field.details?.type === "Otp") {
    return field.details.content?.code ?? field.value;
  }
  return field.value;
}

function pickNamed<T>(
  items: readonly T[],
  nameOrId: string,
  idOf: (item: T) => string,
  titleOf: (item: T) => string,
  kind: string,
): T {
  const byId = items.find((item) => idOf(item) === nameOrId);
  if (byId !== undefined) return byId;
  const lowered = nameOrId.toLowerCase();
  const byTitle = items.filter(
    (item) => titleOf(item).toLowerCase() === lowered,
  );
  const unique = byTitle[0];
  if (byTitle.length === 1 && unique !== undefined) return unique;
  if (byTitle.length > 1) {
    throw new OnePasswordError(
      `More than one ${kind} named "${nameOrId}". Use its id.`,
    );
  }
  throw new OnePasswordError(`No ${kind} named "${nameOrId}".`);
}

async function collect<T>(
  value: T[] | AsyncIterable<T> | Promise<T[] | AsyncIterable<T>>,
): Promise<T[]> {
  const resolved = await value;
  if (Array.isArray(resolved)) return resolved;
  const out: T[] = [];
  for await (const item of resolved) out.push(item);
  return out;
}
