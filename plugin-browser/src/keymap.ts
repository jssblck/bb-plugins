// Translate a DOM KeyboardEvent into the fields Input.dispatchKeyEvent wants.
import type { KeyInput } from "./types.ts";

const MODIFIER_ALT = 1;
const MODIFIER_CTRL = 2;
const MODIFIER_META = 4;
const MODIFIER_SHIFT = 8;

/** Keys that carry text even though `key` is a name rather than a character. */
const TEXT_FOR_NAMED_KEY: Record<string, string> = {
  Enter: "\r",
  NumpadEnter: "\r",
  Tab: "\t",
};

interface KeyboardEventLike {
  key: string;
  code: string;
  keyCode: number;
  location: number;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? MODIFIER_ALT : 0) |
    (event.ctrlKey ? MODIFIER_CTRL : 0) |
    (event.metaKey ? MODIFIER_META : 0) |
    (event.shiftKey ? MODIFIER_SHIFT : 0)
  );
}

export function toKeyInput(
  event: KeyboardEventLike,
  pressed: boolean,
): KeyInput {
  // With a non-shift modifier held the keystroke is a shortcut, not text, so
  // sending text would type a character instead of triggering the shortcut.
  const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
  const text = isShortcut
    ? undefined
    : (TEXT_FOR_NAMED_KEY[event.key] ??
      (event.key.length === 1 ? event.key : undefined));

  return {
    kind: "key",
    type: pressed ? (text ? "keyDown" : "rawKeyDown") : "keyUp",
    key: event.key,
    code: event.code,
    ...(text ? { text, unmodifiedText: text.toLowerCase() } : {}),
    windowsVirtualKeyCode: event.keyCode,
    nativeVirtualKeyCode: event.keyCode,
    modifiers: modifiersOf(event),
    location: event.location,
    autoRepeat: event.repeat,
  };
}
