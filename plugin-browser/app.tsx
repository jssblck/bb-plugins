// bb-plugin-browser — frontend entry.
//
// Registers the Browser thread panel. Each thread drives its own browser
// session, so the panel is thread-scoped rather than a global nav panel. All
// browser state lives on the backend; this bundle renders the screencast and
// forwards input over rpc.
import { definePluginApp } from "@bb/plugin-sdk/app";

import { BrowserPanel } from "./components/browser-panel";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "browser",
    title: "Browser",
    icon: "Browser",
    layout: "flush",
    component: BrowserPanel,
  });
});
