// Every command bb can run against this browser.
//
// Reads go through chrome.scripting, which needs no debugger banner. Input,
// arbitrary JavaScript, and screenshots of background tabs go through CDP.
import * as cdp from "./cdp.js";

const LOAD_TIMEOUT_MS = 30_000;
const WAIT_POLL_MS = 200;

const KEYS = {
  Enter: { keyCode: 13, code: "Enter", text: "\r" },
  Tab: { keyCode: 9, code: "Tab" },
  Escape: { keyCode: 27, code: "Escape" },
  Backspace: { keyCode: 8, code: "Backspace" },
  Delete: { keyCode: 46, code: "Delete" },
  ArrowUp: { keyCode: 38, code: "ArrowUp" },
  ArrowDown: { keyCode: 40, code: "ArrowDown" },
  ArrowLeft: { keyCode: 37, code: "ArrowLeft" },
  ArrowRight: { keyCode: 39, code: "ArrowRight" },
  PageUp: { keyCode: 33, code: "PageUp" },
  PageDown: { keyCode: 34, code: "PageDown" },
  Home: { keyCode: 36, code: "Home" },
  End: { keyCode: 35, code: "End" },
};

const summarize = (tab) => ({
  tabId: tab.id,
  windowId: tab.windowId,
  url: tab.url ?? "",
  title: tab.title ?? "",
  active: tab.active === true,
  loading: tab.status === "loading",
});

async function requireTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab) throw new Error(`No such tab: ${tabId}`);
  return tab;
}

async function runInPage(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  if (!injection) throw new Error("Script did not run in the page");
  return injection.result;
}

/** Resolves when the tab finishes loading, or immediately if it already has. */
function waitForLoad(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === "complete") finish();
    });
  });
}

/** Scrolls the element into view and returns its center in CSS pixels. */
function locate(selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  element.scrollIntoView({ block: "center", inline: "center" });
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function clickAt(tabId, x, y) {
  const point = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 };
  await cdp.send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none" });
  await cdp.send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point });
  await cdp.send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point });
}

async function pressKey(tabId, key) {
  const descriptor = KEYS[key];
  if (!descriptor) throw new Error(`Unsupported key: ${key}. Known keys: ${Object.keys(KEYS).join(", ")}`);
  const base = {
    key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.keyCode,
    nativeVirtualKeyCode: descriptor.keyCode,
  };
  await cdp.send(tabId, "Input.dispatchKeyEvent", {
    type: descriptor.text ? "keyDown" : "rawKeyDown",
    ...base,
    ...(descriptor.text ? { text: descriptor.text } : {}),
  });
  await cdp.send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

const commands = {
  async info() {
    const platform = await chrome.runtime.getPlatformInfo();
    return {
      extensionVersion: chrome.runtime.getManifest().version,
      os: platform.os,
      attachedTabs: cdp.attachedTabs(),
    };
  },

  async "tabs.list"() {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.map(summarize) };
  },

  async "tabs.get"({ tabId }) {
    return summarize(await requireTab(tabId));
  },

  async "tabs.open"({ url, active = false, windowId }) {
    const tab = await chrome.tabs.create({
      url,
      active,
      ...(windowId === undefined ? {} : { windowId }),
    });
    await waitForLoad(tab.id);
    return summarize(await requireTab(tab.id));
  },

  async "tabs.navigate"({ tabId, url }) {
    await requireTab(tabId);
    await chrome.tabs.update(tabId, { url });
    await waitForLoad(tabId);
    return summarize(await requireTab(tabId));
  },

  async "tabs.select"({ tabId }) {
    const tab = await requireTab(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return summarize(await requireTab(tabId));
  },

  async "tabs.close"({ tabId }) {
    await cdp.detach(tabId);
    await chrome.tabs.remove(tabId);
    return { closed: tabId };
  },

  async "tabs.reload"({ tabId }) {
    await chrome.tabs.reload(tabId);
    await waitForLoad(tabId);
    return summarize(await requireTab(tabId));
  },

  async "tabs.release"({ tabId }) {
    await cdp.detach(tabId);
    return { released: tabId };
  },

  async "page.text"({ tabId }) {
    await requireTab(tabId);
    const text = await runInPage(tabId, () => document.body?.innerText ?? "");
    return { text };
  },

  async "page.html"({ tabId }) {
    await requireTab(tabId);
    const html = await runInPage(tabId, () => document.documentElement?.outerHTML ?? "");
    return { html };
  },

  async "page.eval"({ tabId, expression }) {
    await requireTab(tabId);
    const response = await cdp.send(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    }
    return { value: response.result.value ?? response.result.description ?? null };
  },

  async "page.screenshot"({ tabId, fullPage = false }) {
    await requireTab(tabId);
    const { data } = await cdp.send(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
    });
    return { data };
  },

  async "page.wait"({ tabId, selector, timeoutMs = 10_000 }) {
    await requireTab(tabId);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await runInPage(tabId, (s) => document.querySelector(s) !== null, [selector]);
      if (found) return { found: true };
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${selector}`);
  },

  async "input.click"({ tabId, selector, x, y }) {
    await requireTab(tabId);
    if (selector) {
      const point = await runInPage(tabId, locate, [selector]);
      if (!point) throw new Error(`No visible element matches ${selector}`);
      await clickAt(tabId, point.x, point.y);
      return { clicked: selector };
    }
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error("Pass a selector, or both x and y");
    }
    await clickAt(tabId, x, y);
    return { clicked: `${x},${y}` };
  },

  async "input.type"({ tabId, selector, text, submit = false }) {
    await requireTab(tabId);
    if (selector) {
      const point = await runInPage(tabId, locate, [selector]);
      if (!point) throw new Error(`No visible element matches ${selector}`);
      await clickAt(tabId, point.x, point.y);
    }
    // insertText types into the focused element in one shot, which beats
    // synthesizing a key event per character and is what a paste looks like.
    await cdp.send(tabId, "Input.insertText", { text });
    if (submit) await pressKey(tabId, "Enter");
    return { typed: text.length };
  },

  async "input.press"({ tabId, key }) {
    await requireTab(tabId);
    await pressKey(tabId, key);
    return { pressed: key };
  },

  // A CDP wheel event only resolves once the compositor produces a frame, and
  // a background tab never does, so scrolling runs in the page instead.
  async "input.scroll"({ tabId, deltaY = 600 }) {
    await requireTab(tabId);
    const scrollY = await runInPage(
      tabId,
      (delta) => {
        window.scrollBy(0, delta);
        return window.scrollY;
      },
      [deltaY],
    );
    return { scrollY };
  },
};

export async function runCommand(method, params) {
  const command = commands[method];
  if (!command) throw new Error(`Unknown command: ${method}`);
  return (await command(params)) ?? null;
}
