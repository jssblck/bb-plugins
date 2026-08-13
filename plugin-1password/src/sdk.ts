import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { errorMessage, OnePasswordError } from "./errors.ts";

export interface SdkItemField {
  id: string;
  title: string;
  sectionId?: string;
  fieldType: string;
  value: string;
  details?: {
    type?: string;
    content?: { code?: string; errorMessage?: string };
  };
}

export interface SdkItemSection {
  id: string;
  title: string;
}

export interface SdkItem {
  id: string;
  title: string;
  category: string;
  vaultId: string;
  fields: SdkItemField[];
  sections: SdkItemSection[];
  notes: string;
  tags: string[];
  websites: unknown[];
  version: number;
  files: unknown[];
}

export interface SdkItemOverview {
  id: string;
  title: string;
  category: string;
  vaultId: string;
}

export interface SdkVaultOverview {
  id: string;
  title: string;
  activeItemCount: number;
}

export interface SdkClient {
  vaults: {
    list: (params?: {
      decryptDetails?: boolean;
    }) => Promise<SdkVaultOverview[] | AsyncIterable<SdkVaultOverview>>;
  };
  items: {
    list: (
      vaultId: string,
    ) => Promise<SdkItemOverview[] | AsyncIterable<SdkItemOverview>>;
    get: (vaultId: string, itemId: string) => Promise<SdkItem>;
    put: (item: SdkItem) => Promise<SdkItem>;
    create: (params: {
      title: string;
      category: string;
      vaultId: string;
      fields?: SdkItemField[];
    }) => Promise<SdkItem>;
    delete: (vaultId: string, itemId: string) => Promise<void>;
  };
}

interface SdkModule {
  createClient: (config: {
    auth: unknown;
    integrationName: string;
    integrationVersion: string;
  }) => Promise<SdkClient>;
  DesktopAuth: new (accountName: string) => { accountName: string };
}

const INTEGRATION_NAME = "bb";
const INTEGRATION_VERSION = "0.1.0";

function loadSdk(): SdkModule {
  const here = fileURLToPath(import.meta.url);
  const pluginRoot = join(dirname(here), "..", "package.json");
  try {
    return createRequire(pluginRoot)("@1password/sdk") as SdkModule;
  } catch (error) {
    throw new OnePasswordError(
      `Could not load @1password/sdk from ${pluginRoot}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export async function createDesktopClient(accountName: string): Promise<SdkClient> {
  const sdk = loadSdk();
  return sdk.createClient({
    auth: new sdk.DesktopAuth(accountName),
    integrationName: INTEGRATION_NAME,
    integrationVersion: INTEGRATION_VERSION,
  });
}
