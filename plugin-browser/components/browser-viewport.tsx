import { useCallback, useEffect, useRef, useState } from "react";

import type { BrowserInput, Viewport } from "../src/types.ts";
import { modifiersOf, toKeyInput } from "../src/keymap.ts";
import { cn } from "../lib/utils";

const RESIZE_DEBOUNCE_MS = 200;
const MOUSE_MOVE_INTERVAL_MS = 40;

const BUTTONS = ["left", "middle", "right", "back", "forward"] as const;

export interface BrowserViewportProps {
  streamUrl: string | null;
  running: boolean;
  onInput: (event: BrowserInput) => void;
  onResize: (viewport: Viewport) => void;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function BrowserViewport({
  streamUrl,
  running,
  onInput,
  onResize,
}: BrowserViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastMoveRef = useRef(0);
  const [focused, setFocused] = useState(false);
  // A dropped MJPEG connection leaves a dead <img>; this reconnects it.
  const [streamAttempt, setStreamAttempt] = useState(0);

  // Chrome renders at the size we report, so the frame always matches the
  // surface and normalized coordinates stay accurate across resizes.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onResize({
          width: box.width,
          height: box.height,
          deviceScaleFactor: Math.min(2, window.devicePixelRatio || 1),
        });
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(surface);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [onResize]);

  const positionOf = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  // Scrolling needs a non-passive listener so the panel itself does not scroll.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onInput({
        kind: "mouse",
        type: "mouseWheel",
        ...positionOf(event.clientX, event.clientY),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        modifiers: modifiersOf(event),
      });
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, [onInput, positionOf]);

  const mouseEvent = useCallback(
    (
      type: "mousePressed" | "mouseReleased" | "mouseMoved",
      event: React.MouseEvent<HTMLDivElement>,
    ): BrowserInput => ({
      kind: "mouse",
      type,
      ...positionOf(event.clientX, event.clientY),
      button:
        type === "mouseMoved" ? "none" : (BUTTONS[event.button] ?? "left"),
      clickCount: type === "mouseMoved" ? 0 : Math.min(3, event.detail || 1),
      modifiers: modifiersOf(event),
    }),
    [positionOf],
  );

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      role="application"
      aria-label="Browser viewport"
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden bg-muted outline-none",
        focused && "ring-2 ring-ring ring-inset",
      )}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={(event) => {
        surfaceRef.current?.focus();
        onInput(mouseEvent("mousePressed", event));
      }}
      onMouseUp={(event) => onInput(mouseEvent("mouseReleased", event))}
      onMouseMove={(event) => {
        const now = Date.now();
        if (now - lastMoveRef.current < MOUSE_MOVE_INTERVAL_MS) return;
        lastMoveRef.current = now;
        onInput(mouseEvent("mouseMoved", event));
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.preventDefault();
        onInput(toKeyInput(event, true));
      }}
      onKeyUp={(event) => {
        event.preventDefault();
        onInput(toKeyInput(event, false));
      }}
    >
      {streamUrl ? (
        <img
          key={streamAttempt}
          src={`${streamUrl}&attempt=${streamAttempt}`}
          alt=""
          draggable={false}
          onError={() => {
            window.setTimeout(
              () => setStreamAttempt((attempt) => attempt + 1),
              1000,
            );
          }}
          className="pointer-events-none h-full w-full select-none object-fill"
        />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {running
            ? "Waiting for the first frame…"
            : "The browser is not running."}
        </div>
      )}
    </div>
  );
}
