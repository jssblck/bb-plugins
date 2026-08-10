// Which session a thread drives.
//
// A spawned child thread shares its parent's browser, so a workflow's
// subagents and their coordinator drive one set of tabs and one cookie jar.
// Walking to the root of the parent chain gives that key. A fork is a peer
// exploration rather than a subagent, so it starts a session of its own.
import type { BbPluginApi } from "@bb/plugin-sdk";

/** Calls made outside any thread share this key. */
export const SCRATCH_SESSION_KEY = "scratch";

export type SessionKeyResolver = (
  threadId: string | undefined,
) => Promise<string>;

export function createSessionKeyResolver(bb: BbPluginApi): SessionKeyResolver {
  // A thread's ancestry never changes, so a resolved key is cacheable forever.
  const cache = new Map<string, string>();

  return async (threadId) => {
    if (!threadId) return SCRATCH_SESSION_KEY;
    const cached = cache.get(threadId);
    if (cached) return cached;

    const walked: string[] = [];
    let current = threadId;
    let root = threadId;
    while (!walked.includes(current)) {
      walked.push(current);
      let thread;
      try {
        thread = await bb.sdk.threads.get({ threadId: current });
      } catch {
        // An unreadable thread is as far up as we can see; stop here.
        break;
      }
      root = current;
      if (thread.childOrigin === "fork") break;
      if (!thread.parentThreadId) break;
      current = thread.parentThreadId;
    }

    for (const id of walked) cache.set(id, root);
    return root;
  };
}
