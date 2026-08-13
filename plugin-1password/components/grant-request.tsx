import { useState } from "react";
import type { PluginPendingInteractionProps } from "@bb/plugin-sdk/app";

import { parseGrantRequestPayload } from "../src/grant-request.ts";
import { Button } from "@/components/ui/button";

export function GrantRequestInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const payload = parseGrantRequestPayload(interaction.payload);
  const [busy, setBusy] = useState(false);

  if (payload === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This access request is invalid.
        </p>
        <Button variant="outline" onClick={() => void cancel().catch(() => undefined)}>
          Cancel
        </Button>
      </div>
    );
  }

  const modeLabel = payload.mode === "readwrite" ? "Read and write" : "Read";

  async function finish(approved: boolean) {
    setBusy(true);
    try {
      if (approved) await submit({ approved: true });
      else await cancel();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {payload.purpose !== null ? (
          <p className="text-pretty text-sm leading-relaxed text-foreground">
            {payload.purpose}
          </p>
        ) : (
          <p className="text-pretty text-sm leading-relaxed text-foreground">
            An agent wants {modeLabel.toLowerCase()} access to this 1Password
            item for the current project.
          </p>
        )}
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Item</dt>
            <dd className="min-w-0 font-medium">{payload.itemTitle}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Vault</dt>
            <dd className="min-w-0">{payload.vaultTitle}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Access</dt>
            <dd className="min-w-0">{modeLabel}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Account</dt>
            <dd className="min-w-0 text-muted-foreground">
              {payload.accountLabel}
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void finish(false)}
        >
          Deny
        </Button>
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void finish(true)}
        >
          Allow {modeLabel.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}
