// The live view transport: a multipart/x-mixed-replace JPEG stream that an
// <img> tag renders natively, so screencast frames never travel as JSON.
//
// The query names the session to watch; a viewer also keeps that session out
// of the idle reaper for as long as it stays connected.
import type { PluginHttpHandler } from "@bb/plugin-sdk";

import type { SessionRegistry } from "./sessions.ts";

const BOUNDARY = "bbbrowserframe";

function encodePart(frame: Buffer): Buffer {
  const header = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
  return Buffer.concat([
    Buffer.from(header, "latin1"),
    frame,
    Buffer.from("\r\n", "latin1"),
  ]);
}

export function createStreamHandler(
  sessions: SessionRegistry,
  token: string,
): PluginHttpHandler {
  return (context) => {
    if (context.req.query("token") !== token) {
      return new Response("Forbidden", { status: 403 });
    }
    const key = context.req.query("session");
    if (!key) return new Response("Missing session", { status: 400 });
    const session = sessions.peek(key);
    if (!session) return new Response("No such session", { status: 404 });

    let unsubscribe: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (frame: Buffer) => {
          // Drop frames instead of buffering them when the viewer falls behind.
          if ((controller.desiredSize ?? 0) <= 0) return;
          try {
            controller.enqueue(encodePart(frame));
          } catch {
            stop();
          }
        };
        const stop = () => {
          unsubscribe?.();
          unsubscribe = null;
        };

        const last = session.lastFrame;
        if (last) push(last);
        unsubscribe = session.onFrame(push);
        context.req.raw.signal.addEventListener("abort", stop, { once: true });
      },
      cancel() {
        unsubscribe?.();
        unsubscribe = null;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        "cache-control": "no-store, no-transform",
        // Defeats proxy buffering, which would otherwise stall the stream.
        "x-accel-buffering": "no",
      },
    });
  };
}
