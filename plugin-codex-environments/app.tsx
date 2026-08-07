import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  mountInlineEnvironmentSelector,
  PROJECT_ATTRIBUTE,
  PROJECT_EVENT,
} from "./inline-environment";
import "./app.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ThreadEnvironmentState {
  environmentId: string | null;
  environmentName: string | null;
  configPath: string | null;
  configName: string | null;
  lifecycleStatus: string;
  lifecycleError: string | null;
  actions: Array<{
    index: number;
    name: string;
    icon: "tool" | "run" | "debug" | "test";
    command: string;
    platform: "darwin" | "linux" | "win32" | null;
  }>;
  terminals: Array<{
    id: string;
    name: string;
    status: "starting" | "disconnected" | "running" | "exited";
    exitCode: number | null;
  }>;
}

function NewThreadProjectSync() {
  const composer = useComposer();
  const projectId = composer.scope.kind === "new-thread"
    && composer.scope.projectId !== "proj_personal"
    ? composer.scope.projectId
    : null;

  useEffect(() => {
    if (projectId) {
      document.documentElement.setAttribute(PROJECT_ATTRIBUTE, projectId);
    } else {
      document.documentElement.removeAttribute(PROJECT_ATTRIBUTE);
    }
    document.dispatchEvent(
      new CustomEvent(PROJECT_EVENT, { detail: { projectId } }),
    );

    return () => {
      if (document.documentElement.getAttribute(PROJECT_ATTRIBUTE) === projectId) {
        document.documentElement.removeAttribute(PROJECT_ATTRIBUTE);
        document.dispatchEvent(
          new CustomEvent(PROJECT_EVENT, { detail: { projectId: null } }),
        );
      }
    };
  }, [projectId]);

  return null;
}

function EnvironmentPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<ThreadEnvironmentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await rpc.call("threadEnvironment", { threadId }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useRealtime("state-changed", () => void load());

  async function runAction(actionIndex: number) {
    const actionId = `action-${actionIndex}`;
    setBusyId(actionId);
    try {
      await rpc.call("runAction", { threadId, actionIndex });
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setBusyId(null);
    }
  }

  async function stopAction(terminalId: string) {
    setBusyId(terminalId);
    try {
      await rpc.call("stopAction", { terminalId });
      await load();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError));
    } finally {
      setBusyId(null);
    }
  }

  if (!state && !error) {
    return <p className="text-sm text-muted-foreground">Loading environment...</p>;
  }
  if (!state?.environmentId) {
    return (
      <div className="space-y-2">
        <p className="text-sm">This thread does not use a worktree.</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {state.configName ?? "Codex environment"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {state.configPath ?? "No environment file selected"}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span>Lifecycle: {state.lifecycleStatus}</span>
            {state.lifecycleStatus === "setup-failed" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === "retry"}
                onClick={() => {
                  setBusyId("retry");
                  void rpc
                    .call("retrySetup", { threadId })
                    .then(() => load())
                    .catch((retryError) => {
                      setError(
                        retryError instanceof Error
                          ? retryError.message
                          : String(retryError),
                      );
                    })
                    .finally(() => setBusyId(null));
                }}
              >
                Retry setup
              </Button>
            ) : null}
          </div>
          {state.lifecycleError ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-destructive">
              {state.lifecycleError}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions and services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This environment has no actions.
            </p>
          ) : (
            state.actions.map((action) => (
              <div className="flex items-center justify-between gap-3" key={action.index}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{action.name}</p>
                  <code className="block truncate text-xs text-muted-foreground">
                    {action.command}
                  </code>
                  {action.platform ? (
                    <p className="text-xs text-muted-foreground">{action.platform} only</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === `action-${action.index}`}
                  onClick={() => void runAction(action.index)}
                >
                  Run
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {state.terminals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Started commands</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.terminals.map((terminal) => (
              <div className="flex items-center justify-between gap-3" key={terminal.id}>
                <div>
                  <p className="text-sm font-medium">{terminal.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {terminal.status}
                    {terminal.exitCode === null ? "" : ` (exit ${terminal.exitCode})`}
                  </p>
                </div>
                {terminal.status !== "exited" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === terminal.id}
                    onClick={() => void stopAction(terminal.id)}
                  >
                    Stop
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function HeaderEnvironmentAction({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Open Codex environment"
      onClick={() => {
        navigate.openThreadPanel({ actionId: "environment", title: "Environment" });
      }}
    >
      Env
    </Button>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "inline-environment-selector",
    mount({ signal }) {
      return mountInlineEnvironmentSelector(signal);
    },
  });
  app.composer.customize({
    id: "new-thread-environment-project",
    scopes: ["new-thread"],
    actions: [{ id: "project-sync", component: NewThreadProjectSync }],
  });
  app.slots.threadPanelAction({
    id: "environment",
    title: "Environment actions",
    icon: "Terminal",
    component: EnvironmentPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "environment",
    title: "Environment",
    component: HeaderEnvironmentAction,
  });
});
