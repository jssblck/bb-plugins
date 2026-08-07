import { z } from "zod";

export const PROJECT_ATTRIBUTE = "data-bb-codex-environment-project";
export const PROJECT_EVENT = "bb-codex-environment-project";

const configSchema = z.object({
  path: z.string(),
  name: z.string(),
  error: z.string().nullable(),
});
const projectEnvironmentSchema = z.object({
  configs: z.array(configSchema),
  selectedPath: z.string().nullable(),
  error: z.string().nullable(),
});
type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;

const rpcEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const projectEventSchema = z.object({ projectId: z.string().nullable() });

async function callRpc(method: string, input: unknown): Promise<unknown> {
  const response = await fetch(
    `/api/v1/plugins/codex-environments/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const envelope = rpcEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.result;
}

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("codex-env-inline-icon");
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.7");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

function gearIcon() {
  return icon([
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-2v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06L9 17.34l.06-.06A1.7 1.7 0 0 0 9.4 15.4a1.7 1.7 0 0 0-1.56-1.04H7v-2h.84A1.7 1.7 0 0 0 9.4 11.3a1.7 1.7 0 0 0-.34-1.88L9 9.36l1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 13.4 6.8V6h2v.8a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 9.4l-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04H21v2h-.04A1.7 1.7 0 0 0 19.4 15Z",
  ]);
}

function chevronIcon() {
  return icon(["m8 10 4 4 4-4"]);
}

function checkIcon() {
  return icon(["m6 12 4 4 8-9"]);
}

function selectedName(state: ProjectEnvironment | null): string {
  if (!state) return "Environment";
  if (!state.selectedPath) return "No environment";
  return state.configs.find((config) => config.path === state.selectedPath)?.name
    ?? "Environment";
}

export function mountInlineEnvironmentSelector(signal: AbortSignal) {
  let projectId = document.documentElement.getAttribute(PROJECT_ATTRIBUTE);
  let state: ProjectEnvironment | null = null;
  let button: HTMLButtonElement | null = null;
  let menu: HTMLDivElement | null = null;
  let refreshVersion = 0;
  let reconcileQueued = false;

  function closeMenu() {
    menu?.remove();
    menu = null;
    button?.setAttribute("data-state", "closed");
    button?.setAttribute("aria-expanded", "false");
  }

  function renderButton() {
    if (!button) return;
    const label = document.createElement("span");
    label.className = "codex-env-inline-label";
    label.textContent = selectedName(state);
    button.replaceChildren(gearIcon(), label, chevronIcon());
    button.title = `Codex environment: ${selectedName(state)}`;
  }

  function menuItem(
    label: string,
    selected: boolean,
    onSelect: () => void,
    options: { disabled?: boolean; title?: string } = {},
  ) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "codex-env-inline-item";
    item.role = "menuitemradio";
    item.ariaChecked = String(selected);
    item.disabled = options.disabled ?? false;
    if (options.title) item.title = options.title;
    const text = document.createElement("span");
    text.className = "codex-env-inline-item-label";
    text.textContent = label;
    const trailing = document.createElement("span");
    trailing.className = "codex-env-inline-trailing";
    if (selected) trailing.append(checkIcon());
    item.append(text, trailing);
    item.addEventListener("click", onSelect, { signal });
    return item;
  }

  async function select(configPath: string | null) {
    if (!projectId) return;
    try {
      await callRpc("selectProjectEnvironment", { projectId, configPath });
      closeMenu();
      await refresh();
    } catch (error) {
      if (!menu) return;
      const message = document.createElement("div");
      message.className = "codex-env-inline-error";
      message.textContent = error instanceof Error ? error.message : String(error);
      menu.append(message);
    }
  }

  function placeMenu() {
    if (!menu || !button) return;
    const anchor = button.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, anchor.left),
      window.innerWidth - bounds.width - 8,
    );
    const below = anchor.bottom + 6;
    const top = below + bounds.height <= window.innerHeight - 8
      ? below
      : Math.max(8, anchor.top - bounds.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openMenu() {
    if (!button || menu) return;
    menu = document.createElement("div");
    menu.className = "codex-env-inline-menu";
    menu.role = "menu";
    const title = document.createElement("div");
    title.className = "codex-env-inline-title";
    title.textContent = "Environment";
    menu.append(title);
    if (!state) {
      const loading = document.createElement("div");
      loading.className = "codex-env-inline-message";
      loading.textContent = "Loading environments...";
      menu.append(loading);
    } else {
      menu.append(
        menuItem(
          "Work without environment",
          state.selectedPath === null,
          () => void select(null),
        ),
      );
      for (const config of state.configs) {
        menu.append(
          menuItem(
            config.error ? `${config.name} (invalid)` : config.name,
            state.selectedPath === config.path,
            () => void select(config.path),
            {
              disabled: config.error !== null,
              title: config.error ?? undefined,
            },
          ),
        );
      }
      if (state.configs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "codex-env-inline-message";
        empty.textContent = "No environments found";
        menu.append(empty);
      }
      if (state.error) {
        const error = document.createElement("div");
        error.className = "codex-env-inline-error";
        error.textContent = state.error;
        menu.append(error);
      }
    }
    document.body.append(menu);
    button.setAttribute("data-state", "open");
    button.setAttribute("aria-expanded", "true");
    placeMenu();
  }

  async function refresh() {
    const version = ++refreshVersion;
    if (!projectId) {
      state = null;
      renderButton();
      return;
    }
    try {
      const result = projectEnvironmentSchema.parse(
        await callRpc("projectEnvironment", { projectId }),
      );
      if (version !== refreshVersion) return;
      state = result;
    } catch (error) {
      if (version !== refreshVersion) return;
      state = {
        configs: [],
        selectedPath: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    renderButton();
    if (menu) {
      closeMenu();
      openMenu();
    }
  }

  function reconcile() {
    if (!projectId) {
      button?.remove();
      button = null;
      closeMenu();
      return;
    }
    const branch = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Branch"]',
    );
    if (!branch?.parentElement) return;
    const existing = document.querySelector<HTMLButtonElement>(
      "button[data-bb-codex-environment-control]",
    );
    if (existing) {
      button = existing;
      return;
    }
    const nativeEnvironment = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Environment"]',
    );
    button = document.createElement("button");
    button.type = "button";
    button.className = nativeEnvironment?.className ?? branch.className;
    button.dataset.bbCodexEnvironmentControl = "";
    button.setAttribute("aria-label", "Codex environment");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("data-state", "closed");
    button.addEventListener(
      "click",
      () => {
        if (menu) closeMenu();
        else openMenu();
      },
      { signal },
    );
    branch.parentElement.insertBefore(button, branch);
    renderButton();
  }

  function queueReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      reconcile();
    });
  }

  const observer = new MutationObserver(queueReconcile);
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener(
    PROJECT_EVENT,
    (event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = projectEventSchema.safeParse(event.detail);
      if (!parsed.success) return;
      projectId = parsed.data.projectId;
      state = null;
      closeMenu();
      queueReconcile();
      void refresh();
    },
    { signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!menu || !(event.target instanceof Node)) return;
      if (!menu.contains(event.target) && !button?.contains(event.target)) closeMenu();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") closeMenu();
    },
    { signal },
  );
  window.addEventListener("resize", placeMenu, { signal });
  window.addEventListener("scroll", placeMenu, { capture: true, signal });

  reconcile();
  void refresh();

  return () => {
    observer.disconnect();
    closeMenu();
    button?.remove();
  };
}
