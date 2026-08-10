// The extension side of the bb bridge.
//
// One native messaging port carries every command bb sends and every result
// this extension sends back. Chrome owns the port's lifetime: it starts the
// native host on connect and kills it when this worker dies, so reconnecting
// is the only recovery path we need.
import { runCommand } from "./commands.js";
import { detachAll } from "./cdp.js";

const HOST_NAME = "com.bb.browser";
// MV3 workers are evicted when idle. An alarm is the only wake-up Chrome
// guarantees, so it doubles as the reconnect trigger and the liveness ping.
const KEEPALIVE_MINUTES = 0.5;

let port = null;

function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    console.warn("[bb] connectNative failed", error);
    port = null;
    return;
  }

  port.onMessage.addListener((message) => {
    void handle(message);
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    console.warn("[bb] native host disconnected", error?.message ?? "");
    port = null;
    // Debug sessions belong to a connection. Leaving them attached would
    // strand a "being debugged" banner on the user's tabs.
    void detachAll();
  });

  send({ type: "hello", version: chrome.runtime.getManifest().version });
}

function send(message) {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch (error) {
    console.warn("[bb] postMessage failed", error);
    port = null;
  }
}

async function handle(message) {
  if (message?.type === "ping") {
    send({ type: "pong", id: message.id });
    return;
  }
  if (message?.type !== "request") return;

  const { id, method, params } = message;
  try {
    const result = await runCommand(method, params ?? {});
    send({ type: "response", id, ok: true, result });
  } catch (error) {
    send({
      type: "response",
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.alarms.create("bb-keepalive", { periodInMinutes: KEEPALIVE_MINUTES });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());

connect();
