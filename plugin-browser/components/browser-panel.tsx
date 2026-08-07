import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRpc,
  type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";

import type { rpcContract } from "../src/rpc.ts";
import type { BrowserInput, Viewport } from "../src/types.ts";
import { domainOfUrl } from "../src/cookies.ts";
import { BrowserViewport } from "./browser-viewport";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

interface BrowserStatus {
  running: boolean;
  headless: boolean;
  chromeAvailable: boolean;
  endpoint: { port: number; path: string; browserWsUrl: string } | null;
  tabs: {
    targetId: string;
    url: string;
    title: string;
    loading: boolean;
    active: boolean;
  }[];
  activeTargetId: string | null;
  browserContextId: string | null;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  canGoBack: boolean;
  canGoForward: boolean;
  sessionKey: string;
  streamToken: string;
}

/**
 * Calls name this thread; the backend resolves it to a session key, which a
 * spawned thread shares with its parent. Stream and realtime use the resolved
 * key `status` hands back, so a subagent's panel watches the shared browser.
 */
export function BrowserPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);

  const refresh = useCallback(() => {
    void rpc
      .call("status", { session: threadId })
      .then(setStatus)
      .catch(() => {});
  }, [rpc, threadId]);

  useEffect(() => {
    void rpc
      .call("start", { session: threadId })
      .then(setStatus)
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not start the browser",
        );
        refresh();
      });
  }, [rpc, threadId, refresh]);

  useRealtime(`browser-changed:${status?.sessionKey ?? threadId}`, refresh);

  const activeTab = status?.tabs.find((tab) => tab.active) ?? null;
  const activeUrl = activeTab?.url ?? "";

  const send = useCallback(
    (event: BrowserInput) => {
      void rpc.call("sendInput", { session: threadId, event }).catch(() => {});
    },
    [rpc, threadId],
  );

  const resize = useCallback(
    (viewport: Viewport) => {
      void rpc
        .call("setViewport", { session: threadId, ...viewport })
        .catch(() => {});
    },
    [rpc, threadId],
  );

  const act = useCallback(
    (run: () => Promise<unknown>, failure: string) => {
      run()
        .then(refresh)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : failure);
        });
    },
    [refresh],
  );

  const streamUrl = status?.running
    ? `/api/v1/plugins/browser/http/stream?token=${encodeURIComponent(status.streamToken)}&session=${encodeURIComponent(status.sessionKey)}`
    : null;

  if (status && !status.chromeAvailable) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No Chrome binary found. Install Google Chrome, then run{" "}
        <code className="mx-1 rounded bg-muted px-1 py-0.5">
          bb plugin reload browser
        </code>
        .
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Back"
          disabled={!status?.canGoBack}
          onClick={() =>
            act(
              () => rpc.call("goBack", { session: threadId }),
              "Could not go back",
            )
          }
        >
          <Icon name="ChevronLeft" className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Forward"
          disabled={!status?.canGoForward}
          onClick={() =>
            act(
              () => rpc.call("goForward", { session: threadId }),
              "Could not go forward",
            )
          }
        >
          <Icon name="ChevronRight" className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Reload"
          onClick={() =>
            act(
              () => rpc.call("reload", { session: threadId }),
              "Could not reload",
            )
          }
        >
          <Icon
            name={activeTab?.loading ? "Loading" : "RotateCcw"}
            className={cn("size-4", activeTab?.loading && "animate-spin")}
            aria-hidden
          />
        </Button>

        <Input
          className="h-7 flex-1 text-xs"
          spellCheck={false}
          placeholder="Enter a URL or search"
          value={urlDraft ?? activeUrl}
          onChange={(event) => setUrlDraft(event.target.value)}
          onFocus={(event) => {
            setUrlDraft(activeUrl);
            event.target.select();
          }}
          onBlur={() => setUrlDraft(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setUrlDraft(null);
              event.currentTarget.blur();
              return;
            }
            if (event.key !== "Enter") return;
            const url = event.currentTarget.value;
            event.currentTarget.blur();
            act(
              () => rpc.call("navigate", { session: threadId, url }),
              "Could not navigate",
            );
          }}
        />

        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Import cookies from your Chrome"
          onClick={() => setCookieDialogOpen(true)}
        >
          <Icon name="Download" className="size-4" aria-hidden />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="New tab"
          onClick={() =>
            act(
              () => rpc.call("newTab", { session: threadId }),
              "Could not open a tab",
            )
          }
        >
          <Icon name="Plus" className="size-4" aria-hidden />
        </Button>
      </div>

      {status && status.tabs.length > 1 ? (
        <div className="flex items-stretch gap-1 overflow-x-auto border-b border-border px-2 py-1">
          {status.tabs.map((tab) => (
            <div
              key={tab.targetId}
              className={cn(
                "group flex max-w-52 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs",
                tab.active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground",
              )}
            >
              <button
                type="button"
                className="truncate"
                title={tab.url}
                onClick={() =>
                  act(
                    () =>
                      rpc.call("selectTab", {
                        session: threadId,
                        targetId: tab.targetId,
                      }),
                    "Could not select the tab",
                  )
                }
              >
                {tab.title || tab.url || "New tab"}
              </button>
              <button
                type="button"
                aria-label="Close tab"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() =>
                  act(
                    () =>
                      rpc.call("closeTab", {
                        session: threadId,
                        targetId: tab.targetId,
                      }),
                    "Could not close the tab",
                  )
                }
              >
                <Icon name="X" className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <BrowserViewport
        streamUrl={streamUrl}
        running={status?.running ?? false}
        onInput={send}
        onResize={resize}
      />

      <CookieImportDialog
        open={cookieDialogOpen}
        onOpenChange={setCookieDialogOpen}
        defaultDomain={domainOfUrl(activeUrl) ?? ""}
        session={threadId}
        rpc={rpc}
      />
    </div>
  );
}

interface CookieImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDomain: string;
  session: string;
  rpc: Rpc;
}

function CookieImportDialog({
  open,
  onOpenChange,
  defaultDomain,
  session,
  rpc,
}: CookieImportDialogProps) {
  const [domains, setDomains] = useState("");
  const [importing, setImporting] = useState(false);
  const openedRef = useRef(false);

  // Reseed from the current page each time the dialog opens, not on every
  // navigation while it is open.
  useEffect(() => {
    if (open && !openedRef.current) setDomains(defaultDomain);
    openedRef.current = open;
  }, [open, defaultDomain]);

  const runImport = () => {
    setImporting(true);
    const list = domains
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    rpc
      .call("importCookies", { session, domains: list })
      .then((result) => {
        const source =
          result.source === "live-cdp"
            ? "your running Chrome"
            : "your Chrome profile on disk";
        toast.success(`Imported ${result.imported} cookies from ${source}.`);
        onOpenChange(false);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Could not import cookies",
        );
      })
      .finally(() => setImporting(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import cookies from Chrome</DialogTitle>
          <DialogDescription>
            Copies cookies out of your own Chrome so this browser shares your
            logged-in sessions. Leave the field empty to import every domain.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          spellCheck={false}
          placeholder="github.com mail.google.com"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !importing) runImport();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={importing} onClick={runImport}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
