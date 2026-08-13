import { errorMessage, OnePasswordError } from "./errors.ts";
import { createDesktopClient, type SdkClient } from "./sdk.ts";

export const KEEP_ALIVE_MS = 4 * 60 * 1000;

export class SessionManager {
  private readonly clients = new Map<string, SdkClient>();

  isUnlocked(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  unlockedAccountIds(): string[] {
    return [...this.clients.keys()];
  }

  require(accountId: string): SdkClient {
    const client = this.clients.get(accountId);
    if (client === undefined) {
      throw new OnePasswordError(
        "1Password is locked. Unlock it in the 1Password panel, then retry.",
      );
    }
    return client;
  }

  async unlock(accountId: string, aliases: string[] = []): Promise<void> {
    const attempts = [accountId, ...aliases.filter((alias) => alias !== accountId)];
    let lastError: unknown;
    for (const name of attempts) {
      try {
        const client = await createDesktopClient(name);
        this.clients.set(accountId, client);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    this.clients.delete(accountId);
    throw new OnePasswordError(
      `Could not unlock 1Password. Approve the prompt on this Mac, and turn on Settings → Developer → Integrate with other apps. ${errorMessage(lastError)}`,
      { cause: lastError },
    );
  }

  lock(accountId: string): void {
    this.clients.delete(accountId);
  }

  lockAll(): void {
    this.clients.clear();
  }

  async keepAlive(): Promise<string[]> {
    const expired: string[] = [];
    for (const [accountId, client] of this.clients) {
      try {
        await client.vaults.list();
      } catch {
        this.clients.delete(accountId);
        expired.push(accountId);
      }
    }
    return expired;
  }
}
