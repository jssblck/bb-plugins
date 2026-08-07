import { spawn } from "node:child_process";
import type { BbPluginApi } from "@bb/plugin-sdk";

const CAFFEINATE = "/usr/bin/caffeinate";

export default function plugin(bb: BbPluginApi) {
  if (process.platform !== "darwin") {
    bb.status.needsConfiguration(
      "Stay Awake uses macOS caffeinate and does nothing on this platform.",
    );
    return;
  }

  bb.background.service("idle-sleep-assertion", {
    async start(signal) {
      // `-i` holds PreventUserIdleSystemSleep and nothing else: the display
      // still sleeps on its own schedule, the disks still spin down, and
      // closing the lid still sleeps the machine, because clamshell sleep is a
      // forced sleep that idle assertions do not block. `-w` releases the
      // assertion if the bb server dies without running dispose hooks.
      const child = spawn(CAFFEINATE, ["-i", "-w", String(process.pid)], {
        stdio: "ignore",
      });

      await new Promise<void>((resolve, reject) => {
        const stop = () => child.kill("SIGTERM");
        signal.addEventListener("abort", stop, { once: true });

        child.once("spawn", () => {
          bb.log.info(
            `holding idle-sleep assertion (caffeinate pid ${child.pid})`,
          );
        });

        child.once("error", (error) => {
          signal.removeEventListener("abort", stop);
          reject(error);
        });

        child.once("exit", (code, exitSignal) => {
          signal.removeEventListener("abort", stop);
          if (signal.aborted) {
            bb.log.info("released idle-sleep assertion");
            resolve();
            return;
          }
          reject(
            new Error(
              `caffeinate exited unexpectedly (code ${code}, signal ${exitSignal})`,
            ),
          );
        });
      });
    },
  });
}
