// Chrome DevTools Protocol access to the user's own tabs.
//
// Reading a page needs nothing but chrome.scripting, so we attach the debugger
// lazily: only real input, arbitrary JavaScript, and background-tab
// screenshots need it. Every attach paints a banner across the user's tab, so
// the set of attached tabs stays as small as the task allows.
const attached = new Set();

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
}

export async function send(tabId, method, params = {}) {
  await attach(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

export async function detach(tabId) {
  if (!attached.delete(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // The tab or its debug session is already gone.
  }
}

export async function detachAll() {
  await Promise.all([...attached].map((tabId) => detach(tabId)));
}

export function attachedTabs() {
  return [...attached];
}

// The user can end a debug session from the banner, and closing a tab ends it
// implicitly. Both leave our set stale unless we follow Chrome's events.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
});
