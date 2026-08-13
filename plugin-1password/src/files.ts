import { isAbsolute, resolve } from "node:path";

import type { BbPluginApi } from "@bb/plugin-sdk";

import { OnePasswordError } from "./errors.ts";

export function resolveHostPath(cwd: string | undefined, path: string): string {
  if (isAbsolute(path)) return path;
  if (cwd === undefined) {
    throw new OnePasswordError(
      "Relative paths need the invoking working directory.",
    );
  }
  return resolve(cwd, path);
}

export async function resolveThreadHost(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ hostId: string; projectId: string }> {
  const thread = await bb.sdk.threads.get({ threadId, include: "host" });
  const hostId = "host" in thread ? thread.host?.id : undefined;
  if (hostId === undefined) {
    throw new OnePasswordError("The thread needs a live host.");
  }
  return { hostId, projectId: thread.projectId };
}

export async function writeHostFile(
  bb: BbPluginApi,
  args: { hostId: string; path: string; content: string },
): Promise<void> {
  const existing = await bb.sdk.files
    .read({ hostId: args.hostId, path: args.path })
    .catch(() => null);
  const write = await bb.sdk.files.write({
    hostId: args.hostId,
    path: args.path,
    content: args.content,
    contentEncoding: "utf8",
    createParents: true,
    expectedSha256: existing?.sha256,
    mode: 0o600,
  });
  if (write.outcome === "conflict") {
    throw new OnePasswordError(
      `${args.path} changed while it was being written. Retry.`,
    );
  }
}
