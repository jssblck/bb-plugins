// Types shared by the backend, the rpc contract, and the panel bundle.
import type { DevToolsEndpoint } from "./chrome.ts";

export interface TabSummary {
  targetId: string;
  url: string;
  title: string;
  loading: boolean;
  active: boolean;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface BrowserStatus {
  /** True once this session holds a context in a live Chrome. */
  running: boolean;
  headless: boolean;
  endpoint: DevToolsEndpoint | null;
  /** The session's CDP browser context, for picking it out of a CDP attach. */
  browserContextId: string | null;
  tabs: TabSummary[];
  activeTargetId: string | null;
  viewport: Viewport;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface MouseInput {
  kind: "mouse";
  type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel";
  /** Normalized to the viewport so a resize race cannot land a stray click. */
  x: number;
  y: number;
  button?: "none" | "left" | "middle" | "right" | "back" | "forward";
  clickCount?: number;
  modifiers?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface KeyInput {
  kind: "key";
  type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
  key?: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  modifiers?: number;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  location?: number;
  autoRepeat?: boolean;
  isKeypad?: boolean;
}

export type BrowserInput = MouseInput | KeyInput;
