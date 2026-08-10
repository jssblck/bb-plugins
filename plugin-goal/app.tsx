// The thread header control: shows the thread's goal and its iteration count,
// and opens a dialog to pause, resume, or clear it. Nothing renders on threads
// without a goal.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@bb/plugin-sdk/app";
import { toast } from "sonner";

import type { rpcContract } from "./server";
import {
  GOAL_CHANGED_CHANNEL,
  statusLine,
  type Goal,
  type GoalStatus,
} from "./src/goal.ts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";

const STATUS_ICON: Record<GoalStatus, IconName> = {
  active: "Target",
  paused: "Pause",
  "budget-limited": "Clock",
  complete: "CircleCheck",
  blocked: "CircleX",
};

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Goal active",
  paused: "Goal paused",
  "budget-limited": "Goal out of iterations",
  complete: "Goal complete",
  blocked: "Goal blocked",
};

function GoalHeaderAction({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void rpc
      .call("threadGoal", { threadId })
      .then((result) => setGoal(result.goal))
      .catch(() => setGoal(null));
  }, [rpc, threadId]);

  useEffect(refresh, [refresh]);
  useRealtime(GOAL_CHANGED_CHANNEL, (payload) => {
    if ((payload as { threadId?: string }).threadId === threadId) refresh();
  });

  const act = (action: "pause" | "resume" | "clear") => {
    setBusy(true);
    void rpc
      .call("updateGoal", { threadId, action })
      .then((result) => {
        setGoal(result.goal);
        if (action === "clear") setOpen(false);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  if (goal === null) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-muted-foreground"
          aria-label={STATUS_LABEL[goal.status]}
        >
          <Icon name={STATUS_ICON[goal.status]} aria-hidden />
          {isCompactViewport ? null : (
            <span className="text-xs tabular-nums">
              {goal.iterations}/{goal.maxIterations}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Goal</DialogTitle>
          <DialogDescription>{statusLine(goal)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap text-foreground">{goal.objective}</p>
          {goal.outcome === null ? null : (
            <div className="rounded-md border border-border p-3 text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">
                {goal.status === "complete" ? "Evidence" : "Stopped because"}
              </p>
              <p className="whitespace-pre-wrap">{goal.outcome}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => act("clear")}
          >
            Clear
          </Button>
          {goal.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => act("pause")}
            >
              Pause
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => act("resume")}>
              Resume
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "goal",
    title: "Goal",
    component: GoalHeaderAction,
  });
});
