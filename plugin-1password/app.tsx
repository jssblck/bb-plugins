import { definePluginApp } from "@bb/plugin-sdk/app";

import { GrantRequestInteraction } from "./components/grant-request";
import { OnePasswordPanel } from "./components/one-password-panel";
import { GRANT_REQUEST_RENDERER } from "./src/grant-request.ts";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "vaults",
    title: "1Password",
    icon: "Lock",
    path: "vaults",
    component: OnePasswordPanel,
  });
  app.slots.pendingInteraction({
    id: GRANT_REQUEST_RENDERER,
    component: GrantRequestInteraction,
  });
});
