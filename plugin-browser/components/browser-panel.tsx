import { useCallback, useEffect, useState } from "react";
import {
  useRealtime,
  useRpc,
  type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";

import type { rpcContract } from "../src/rpc.ts";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

interface Tab {
  tabId: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  loading: boolean;
}

interface Status {
  connected: boolean;
  browsers: { id: string; version: string }[];
  sessionKey: string;
  tab: Tab | null;
  extensionDir: string;
}

/**
 * The panel watches the tab this thread drives inside the user's own Chrome.
 * Calls name this thread; the backend resolves it to a session key a spawned
 * thread shares with its parent, and realtime uses the key `status` returns.
 */
export function BrowserPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<Status | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");

  const refresh = useCallback(() => {
    void rpc
      .call("status", { session: threadId })
      .then((next) => {
        setStatus(next);
        if (!next.connected) {
          setTabs([]);
          return;
        }
        void rpc
          .call("tabs", { session: threadId })
          .then((result) => setTabs(result.tabs))
          .catch(() => setTabs([]));
      })
      .catch(() => {});
  }, [rpc, threadId]);

  useEffect(refresh, [refresh]);
  useRealtime(`browser-changed:${status?.sessionKey ?? threadId}`, refresh);
  useRealtime("browser-connections", refresh);

  const act = useCallback(
    (run: () => Promise<unknown>, failure: string) => {
      run()
        .then(() => refresh())
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : failure);
        });
    },
    [refresh],
  );

  const takePreview = useCallback(() => {
    void rpc
      .call("preview", { session: threadId })
      .then((result) => setPreview(result.dataUrl))
      .catch(() => setPreview(null));
  }, [rpc, threadId]);

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Icon name="Puzzle" className="size-8 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm font-medium">No browser connected</p>
          <p className="text-sm text-muted-foreground">
            Load the bb Browser extension in Chrome: open chrome://extensions,
            turn on Developer mode, choose Load unpacked, and select this folder.
          </p>
          <code className="block break-all rounded-md bg-muted px-2 py-1 text-xs">
            {status.extensionDir}
          </code>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              act(
                () =>
                  rpc
                    .call("install", null)
                    .then((result) => toast.success(result.summary)),
                "Could not install the native messaging host",
              )
            }
          >
            Reinstall native host
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  const bound = status.tab;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!urlDraft.trim()) return;
          act(
            () => rpc.call("open", { session: threadId, url: urlDraft.trim() }),
            "Could not open that URL",
          );
          setUrlDraft("");
        }}
      >
        <Input
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          placeholder="Open a URL in this thread's tab"
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!urlDraft.trim()}>
          Open
        </Button>
      </form>

      {bound ? (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-start gap-2">
            <Icon name="Browser" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {bound.title || bound.url}
              </p>
              <p className="truncate text-xs text-muted-foreground">{bound.url}</p>
            </div>
            {bound.loading ? (
              <span className="text-xs text-muted-foreground">loading…</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(() => rpc.call("show", { session: threadId }), "Could not show the tab")
              }
            >
              <Icon name="Eye" /> Show
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(() => rpc.call("reload", { session: threadId }), "Could not reload")
              }
            >
              <Icon name="RotateCcw" /> Reload
            </Button>
            <Button size="sm" variant="outline" onClick={takePreview}>
              Preview
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(() => rpc.call("release", { session: threadId }), "Could not release")
              }
            >
              Release
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(() => rpc.call("close", { session: threadId }), "Could not close the tab")
              }
            >
              Close
            </Button>
          </div>
          {preview ? (
            <img
              src={preview}
              alt="Screenshot of this thread's tab"
              className="w-full rounded-md border border-border"
            />
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          This thread has no tab yet. Open a URL above, or claim one of the tabs
          below.
        </p>
      )}

      <div className="space-y-1">
        <p className="px-1 text-xs font-medium text-muted-foreground">
          Open tabs ({tabs.length})
        </p>
        {tabs.map((tab) => (
          <button
            key={tab.tabId}
            type="button"
            onClick={() =>
              act(
                () => rpc.call("attach", { session: threadId, tabId: tab.tabId }),
                "Could not claim that tab",
              )
            }
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
              bound?.tabId === tab.tabId && "bg-muted",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{tab.title || tab.url}</p>
              <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
            </div>
            {bound?.tabId === tab.tabId ? (
              <Icon name="Check" className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
