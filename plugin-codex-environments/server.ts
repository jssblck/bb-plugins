import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import {
  configPathFromAbsolute,
  joinRemotePath,
  normalizeConfigPath,
  parseEnvironmentConfig,
  platformSchema,
  scriptForPlatform,
  type EnvironmentConfig,
  type Platform,
} from "./environment-config";

const configSummarySchema = z.object({
  path: z.string(),
  name: z.string(),
  error: z.string().nullable(),
});

const actionSummarySchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  icon: z.enum(["tool", "run", "debug", "test"]),
  command: z.string(),
  platform: platformSchema.nullable(),
});

const terminalSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["starting", "disconnected", "running", "exited"]),
  exitCode: z.number().int().nullable(),
});

export const rpcContract = defineRpcContract({
  projectEnvironment: {
    input: z.object({ projectId: z.string() }).strict(),
    output: z.object({
      configs: z.array(configSummarySchema),
      selectedPath: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  selectProjectEnvironment: {
    input: z
      .object({ projectId: z.string(), configPath: z.string().nullable() })
      .strict(),
    output: z.object({ selectedPath: z.string().nullable() }),
  },
  threadEnvironment: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      environmentId: z.string().nullable(),
      environmentName: z.string().nullable(),
      configPath: z.string().nullable(),
      configName: z.string().nullable(),
      lifecycleStatus: z.string(),
      lifecycleError: z.string().nullable(),
      actions: z.array(actionSummarySchema),
      terminals: z.array(terminalSummarySchema),
    }),
  },
  runAction: {
    input: z
      .object({ threadId: z.string(), actionIndex: z.number().int().nonnegative() })
      .strict(),
    output: z.object({ terminalId: z.string() }),
  },
  stopAction: {
    input: z.object({ terminalId: z.string() }).strict(),
    output: z.object({ stopped: z.boolean() }),
  },
  retrySetup: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ queued: z.boolean() }),
  },
});

const selectionRowSchema = z.object({ config_path: z.string().nullable() });
const lifecycleRowSchema = z.object({
  environment_id: z.string(),
  project_id: z.string(),
  config_path: z.string().nullable(),
  status: z.string(),
  setup_terminal_id: z.string().nullable(),
  cleanup_terminal_id: z.string().nullable(),
  last_error: z.string().nullable(),
});
const actionTerminalRowSchema = z.object({
  terminal_id: z.string(),
  environment_id: z.string(),
  action_name: z.string(),
});

type LifecycleRow = z.infer<typeof lifecycleRowSchema>;

interface ProjectSource {
  hostId: string;
  path: string;
}

interface LoadedConfig {
  path: string;
  config: EnvironmentConfig;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Plugin stopped"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Plugin stopped"));
      },
      { once: true },
    );
  });
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function commandWithCodexVariables(
  script: string,
  platform: Platform,
  sourcePath: string,
  worktreePath: string,
): string {
  if (platform === "win32") {
    return [
      `$env:CODEX_SOURCE_TREE_PATH = ${quotePowerShell(sourcePath)}`,
      `$env:CODEX_WORKTREE_PATH = ${quotePowerShell(worktreePath)}`,
      script,
    ].join("\n");
  }
  return [
    `export CODEX_SOURCE_TREE_PATH=${quotePosix(sourcePath)}`,
    `export CODEX_WORKTREE_PATH=${quotePosix(worktreePath)}`,
    script,
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE project_selection (
      project_id TEXT PRIMARY KEY,
      config_path TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE environment_lifecycle (
      environment_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      config_path TEXT,
      status TEXT NOT NULL,
      setup_terminal_id TEXT,
      cleanup_terminal_id TEXT,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE action_terminal (
      terminal_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  ]);

  const getSelectionStatement = db.prepare(
    "SELECT config_path FROM project_selection WHERE project_id = ?",
  );
  const setSelectionStatement = db.prepare(`
    INSERT INTO project_selection (project_id, config_path, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      config_path = excluded.config_path,
      updated_at = excluded.updated_at
  `);
  const getLifecycleStatement = db.prepare(
    "SELECT environment_id, project_id, config_path, status, setup_terminal_id, cleanup_terminal_id, last_error FROM environment_lifecycle WHERE environment_id = ?",
  );
  const createLifecycleStatement = db.prepare(`
    INSERT OR IGNORE INTO environment_lifecycle
      (environment_id, project_id, config_path, status, setup_terminal_id, cleanup_terminal_id, last_error, updated_at)
    VALUES (?, ?, ?, 'setup-pending', NULL, NULL, NULL, ?)
  `);
  const updateLifecycleStatement = db.prepare(`
    UPDATE environment_lifecycle
    SET status = ?, setup_terminal_id = COALESCE(?, setup_terminal_id),
        cleanup_terminal_id = COALESCE(?, cleanup_terminal_id),
        last_error = ?, updated_at = ?
    WHERE environment_id = ?
  `);
  const addActionTerminalStatement = db.prepare(
    "INSERT INTO action_terminal (terminal_id, environment_id, action_name, created_at) VALUES (?, ?, ?, ?)",
  );
  const getActionTerminalStatement = db.prepare(
    "SELECT terminal_id, environment_id, action_name FROM action_terminal WHERE terminal_id = ?",
  );
  const listActionTerminalsStatement = db.prepare(
    "SELECT terminal_id, environment_id, action_name FROM action_terminal WHERE environment_id = ? ORDER BY created_at DESC",
  );
  const deleteActionTerminalStatement = db.prepare(
    "DELETE FROM action_terminal WHERE terminal_id = ?",
  );

  const abortController = new AbortController();
  const platformByHost = new Map<string, Platform>();
  const environmentQueues = new Map<string, Promise<void>>();

  function getSelection(projectId: string): string | null | undefined {
    const row = getSelectionStatement.get(projectId);
    if (row === undefined) return undefined;
    return selectionRowSchema.parse(row).config_path;
  }

  function getLifecycle(environmentId: string): LifecycleRow | null {
    const row = getLifecycleStatement.get(environmentId);
    return row === undefined ? null : lifecycleRowSchema.parse(row);
  }

  function updateLifecycle(
    environmentId: string,
    status: string,
    options: {
      setupTerminalId?: string;
      cleanupTerminalId?: string;
      error?: string | null;
    } = {},
  ) {
    updateLifecycleStatement.run(
      status,
      options.setupTerminalId ?? null,
      options.cleanupTerminalId ?? null,
      options.error ?? null,
      Date.now(),
      environmentId,
    );
    bb.realtime.publish("state-changed", { environmentId });
  }

  async function projectSource(projectId: string): Promise<ProjectSource> {
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find((candidate) => candidate.isDefault)
      ?? project.sources[0];
    if (!source) throw new Error(`Project ${project.name} has no local source`);
    return { hostId: source.hostId, path: source.path };
  }

  async function readConfig(
    source: ProjectSource,
    configPath: string,
  ): Promise<LoadedConfig> {
    const normalizedPath = normalizeConfigPath(configPath);
    if (!normalizedPath) throw new Error("Invalid Codex environment path");
    const file = await bb.sdk.files.read({
      hostId: source.hostId,
      path: joinRemotePath(source.path, normalizedPath),
      rootPath: source.path,
    });
    if (file.contentEncoding !== "utf8") {
      throw new Error(`${normalizedPath} is not a UTF-8 text file`);
    }
    const parsed = parseEnvironmentConfig(file.content);
    if (!parsed.ok) throw new Error(`${normalizedPath}: ${parsed.error}`);
    return { path: normalizedPath, config: parsed.config };
  }

  async function listProjectConfigs(projectId: string) {
    const source = await projectSource(projectId);
    const directory = joinRemotePath(source.path, ".codex/environments");
    let files: Awaited<ReturnType<typeof bb.sdk.files.list>>;
    try {
      files = await bb.sdk.files.list({
        hostId: source.hostId,
        path: directory,
        query: ".toml",
        limit: 100,
      });
    } catch (error) {
      const message = errorMessage(error);
      if (/not found|no such file|does not exist/i.test(message)) {
        return { source, configs: [], error: null };
      }
      return { source, configs: [], error: message };
    }

    const paths = Array.from(
      new Set(
        files.files.flatMap((file) => {
          const path = normalizeConfigPath(file.path)
            ?? configPathFromAbsolute(file.path)
            ?? normalizeConfigPath(`.codex/environments/${file.name}`);
          return path ? [path] : [];
        }),
      ),
    ).sort();

    const configs = await Promise.all(
      paths.map(async (path) => {
        try {
          const loaded = await readConfig(source, path);
          return { path, name: loaded.config.name, error: null };
        } catch (error) {
          return { path, name: path.split("/").at(-1) ?? path, error: errorMessage(error) };
        }
      }),
    );
    return {
      source,
      configs,
      error: files.truncated ? "Only the first 100 environment files are shown" : null,
    };
  }

  function automaticSelection(
    configs: Array<{ path: string; error: string | null }>,
  ): string | null {
    const valid = configs.filter((config) => config.error === null);
    return valid.find(
      (config) => config.path === ".codex/environments/environment.toml",
    )?.path ?? (valid.length === 1 ? valid[0]?.path ?? null : null);
  }

  async function selectedConfigPath(projectId: string): Promise<string | null> {
    const selected = getSelection(projectId);
    if (selected !== undefined) return selected;
    const overview = await listProjectConfigs(projectId);
    return automaticSelection(overview.configs);
  }

  async function configForEnvironment(
    environmentId: string,
    projectId: string,
    configuredPath?: string | null,
  ): Promise<{ loaded: LoadedConfig; source: ProjectSource; worktreePath: string }> {
    const environment = await bb.sdk.environments.get({ environmentId });
    if (!environment.path) throw new Error("The environment has no workspace path");
    const configPath = configuredPath === undefined
      ? await selectedConfigPath(projectId)
      : configuredPath;
    if (!configPath) throw new Error("No Codex environment is selected");
    const source = await projectSource(projectId);
    const loaded = await readConfig(
      { hostId: environment.hostId, path: environment.path },
      configPath,
    );
    return { loaded, source, worktreePath: environment.path };
  }

  async function waitForTerminal(terminalId: string) {
    while (!abortController.signal.aborted) {
      const terminal = await bb.sdk.terminals.get({ terminalId });
      if (terminal.status === "exited") {
        const output = await bb.sdk.terminals.output({ terminalId, tailBytes: 64_000 });
        const bytes = Buffer.concat(
          output.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64")),
        );
        return { terminal, output: bytes.toString("utf8") };
      }
      await sleep(300, abortController.signal);
    }
    throw new Error("Plugin stopped");
  }

  async function detectPlatform(environmentId: string, hostId: string): Promise<Platform> {
    const cached = platformByHost.get(hostId);
    if (cached) return cached;
    const terminal = await bb.sdk.terminals.create({
      scope: { kind: "environment", environmentId },
      cols: 80,
      rows: 12,
      title: "Detect Codex environment platform",
      start: { mode: "command", command: 'node -p "process.platform"' },
    });
    const result = await waitForTerminal(terminal.id);
    const match = result.output.match(/\b(darwin|linux|win32)\b/);
    const parsed = platformSchema.safeParse(match?.[1]);
    if (!parsed.success) {
      throw new Error("Could not detect the environment platform");
    }
    platformByHost.set(hostId, parsed.data);
    return parsed.data;
  }

  async function runLifecycleScript(
    environmentId: string,
    projectId: string,
    configPath: string,
    kind: "setup" | "cleanup",
  ) {
    const environment = await bb.sdk.environments.get({ environmentId });
    const { loaded, source, worktreePath } = await configForEnvironment(
      environmentId,
      projectId,
      configPath,
    );
    const platform = await detectPlatform(environmentId, environment.hostId);
    const script = scriptForPlatform(loaded.config[kind], platform).trim();
    if (!script) {
      updateLifecycle(environmentId, `${kind}-succeeded`);
      return;
    }
    const terminal = await bb.sdk.terminals.create({
      scope: { kind: "environment", environmentId },
      cols: 100,
      rows: 28,
      title: `${loaded.config.name}: ${kind}`,
      start: {
        mode: "command",
        command: commandWithCodexVariables(
          script,
          platform,
          source.path,
          worktreePath,
        ),
      },
    });
    updateLifecycle(environmentId, `${kind}-running`, {
      ...(kind === "setup"
        ? { setupTerminalId: terminal.id }
        : { cleanupTerminalId: terminal.id }),
    });
    const result = await waitForTerminal(terminal.id);
    if (result.terminal.exitCode !== 0) {
      const tail = result.output.trim().slice(-2_000);
      throw new Error(
        `${kind} exited with ${result.terminal.exitCode ?? "an unknown status"}${tail ? `: ${tail}` : ""}`,
      );
    }
    updateLifecycle(environmentId, `${kind}-succeeded`);
  }

  async function reconcileEnvironment(
    environmentId: string,
    captureIfNew: boolean,
  ) {
    let environment;
    try {
      environment = await bb.sdk.environments.get({ environmentId });
    } catch (error) {
      if (!/not found|unknown environment/i.test(errorMessage(error))) throw error;
      return;
    }
    if (environment.workspaceProvisionType !== "managed-worktree") return;

    let lifecycle = getLifecycle(environmentId);
    if (!lifecycle && captureIfNew) {
      const configPath = await selectedConfigPath(environment.projectId);
      createLifecycleStatement.run(
        environment.id,
        environment.projectId,
        configPath,
        Date.now(),
      );
      lifecycle = getLifecycle(environmentId);
    }
    if (!lifecycle) return;

    if (
      environment.status === "ready" &&
      ["setup-pending", "setup-failed"].includes(lifecycle.status)
    ) {
      if (!lifecycle.config_path) {
        updateLifecycle(environmentId, "setup-skipped");
        return;
      }
      updateLifecycle(environmentId, "setup-starting");
      try {
        await runLifecycleScript(
          environmentId,
          lifecycle.project_id,
          lifecycle.config_path,
          "setup",
        );
      } catch (error) {
        const message = errorMessage(error);
        updateLifecycle(environmentId, "setup-failed", { error: message });
        bb.log.error(`Setup failed for ${environmentId}: ${message}`);
      }
      return;
    }

    if (
      ["retiring", "destroying"].includes(environment.status) &&
      !lifecycle.status.startsWith("cleanup-") &&
      lifecycle.config_path
    ) {
      updateLifecycle(environmentId, "cleanup-starting");
      try {
        await runLifecycleScript(
          environmentId,
          lifecycle.project_id,
          lifecycle.config_path,
          "cleanup",
        );
      } catch (error) {
        const message = errorMessage(error);
        updateLifecycle(environmentId, "cleanup-failed", { error: message });
        bb.log.error(`Cleanup failed for ${environmentId}: ${message}`);
      }
    }
  }

  function enqueueEnvironment(environmentId: string, captureIfNew: boolean) {
    const previous = environmentQueues.get(environmentId) ?? Promise.resolve();
    const next = previous
      .then(() => reconcileEnvironment(environmentId, captureIfNew))
      .catch((error) => {
        bb.log.error(`Environment reconciliation failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (environmentQueues.get(environmentId) === next) {
          environmentQueues.delete(environmentId);
        }
      });
    environmentQueues.set(environmentId, next);
  }

  const unsubscribe = bb.sdk.subscribe({
    event: "environment:changed",
    callback(event) {
      if (!event.id) return;
      enqueueEnvironment(
        event.id,
        event.changes.includes("environment-created"),
      );
    },
  });

  bb.rpc.register(rpcContract, {
    async projectEnvironment({ projectId }) {
      if (projectId === "proj_personal") {
        return { configs: [], selectedPath: null, error: null };
      }
      const overview = await listProjectConfigs(projectId);
      const stored = getSelection(projectId);
      return {
        configs: overview.configs,
        selectedPath: stored === undefined
          ? automaticSelection(overview.configs)
          : stored,
        error: overview.error,
      };
    },

    async selectProjectEnvironment({ projectId, configPath }) {
      const normalized = configPath === null ? null : normalizeConfigPath(configPath);
      if (configPath !== null && !normalized) {
        throw new Error("Invalid Codex environment path");
      }
      if (normalized) {
        const overview = await listProjectConfigs(projectId);
        if (!overview.configs.some((config) => config.path === normalized && !config.error)) {
          throw new Error("The selected environment file is missing or invalid");
        }
      }
      setSelectionStatement.run(projectId, normalized, Date.now());
      bb.realtime.publish("state-changed", { projectId });
      return { selectedPath: normalized };
    },

    async threadEnvironment({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) {
        return {
          environmentId: null,
          environmentName: null,
          configPath: null,
          configName: null,
          lifecycleStatus: "no-worktree",
          lifecycleError: null,
          actions: [],
          terminals: [],
        };
      }
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      if (environment.workspaceProvisionType !== "managed-worktree") {
        return {
          environmentId: null,
          environmentName: environment.name,
          configPath: null,
          configName: null,
          lifecycleStatus: "no-worktree",
          lifecycleError: null,
          actions: [],
          terminals: [],
        };
      }
      const lifecycle = getLifecycle(environment.id);
      const configPath = lifecycle?.config_path
        ?? await selectedConfigPath(thread.projectId);
      let config: EnvironmentConfig | null = null;
      let configName: string | null = null;
      let lifecycleError = lifecycle?.last_error ?? null;
      if (configPath) {
        try {
          const loaded = await configForEnvironment(
            environment.id,
            thread.projectId,
            configPath,
          );
          config = loaded.loaded.config;
          configName = config.name;
        } catch (error) {
          lifecycleError ??= errorMessage(error);
        }
      }

      const rows = z.array(actionTerminalRowSchema).parse(
        listActionTerminalsStatement.all(environment.id),
      );
      const terminals = (
        await Promise.all(
          rows.map(async (row) => {
            try {
              const terminal = await bb.sdk.terminals.get({
                terminalId: row.terminal_id,
              });
              return {
                id: terminal.id,
                name: row.action_name,
                status: terminal.status,
                exitCode: terminal.exitCode,
              };
            } catch {
              deleteActionTerminalStatement.run(row.terminal_id);
              return null;
            }
          }),
        )
      ).filter((terminal) => terminal !== null);

      return {
        environmentId: environment.id,
        environmentName: environment.name ?? environment.branchName,
        configPath,
        configName,
        lifecycleStatus: lifecycle?.status ?? "not-initialized",
        lifecycleError,
        actions: (config?.actions ?? []).map((action, index) => ({
          index,
          name: action.name,
          icon: action.icon ?? "tool",
          command: action.command,
          platform: action.platform ?? null,
        })),
        terminals,
      };
    },

    async runAction({ threadId, actionIndex }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) throw new Error("This thread has no worktree");
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      if (!environment.path) throw new Error("The worktree has no workspace path");
      const lifecycle = getLifecycle(environment.id);
      const loaded = await configForEnvironment(
        environment.id,
        thread.projectId,
        lifecycle?.config_path ?? undefined,
      );
      const action = loaded.loaded.config.actions[actionIndex];
      if (!action) throw new Error("Unknown environment action");
      const platform = await detectPlatform(environment.id, environment.hostId);
      if (action.platform && action.platform !== platform) {
        throw new Error(`${action.name} is only available on ${action.platform}`);
      }
      const terminal = await bb.sdk.terminals.create({
        scope: { kind: "environment", environmentId: environment.id },
        cols: 100,
        rows: 28,
        title: `${loaded.loaded.config.name}: ${action.name}`,
        start: {
          mode: "command",
          command: commandWithCodexVariables(
            action.command,
            platform,
            loaded.source.path,
            loaded.worktreePath,
          ),
        },
      });
      addActionTerminalStatement.run(
        terminal.id,
        environment.id,
        action.name,
        Date.now(),
      );
      bb.realtime.publish("state-changed", { environmentId: environment.id });
      return { terminalId: terminal.id };
    },

    async stopAction({ terminalId }) {
      const row = getActionTerminalStatement.get(terminalId);
      if (row === undefined) return { stopped: false };
      actionTerminalRowSchema.parse(row);
      await bb.sdk.terminals.close({ terminalId, mode: "force" });
      bb.realtime.publish("state-changed", { terminalId });
      return { stopped: true };
    },

    async retrySetup({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) return { queued: false };
      const lifecycle = getLifecycle(thread.environmentId);
      if (!lifecycle?.config_path) return { queued: false };
      updateLifecycle(thread.environmentId, "setup-pending");
      enqueueEnvironment(thread.environmentId, false);
      return { queued: true };
    },
  });

  bb.onDispose(() => {
    unsubscribe();
    abortController.abort();
  });

  bb.log.info("Codex environment lifecycle integration loaded");
}
