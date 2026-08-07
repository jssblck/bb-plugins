import { parse } from "smol-toml";
import { z } from "zod";

export const platformSchema = z.enum(["darwin", "linux", "win32"]);
export type Platform = z.infer<typeof platformSchema>;

const platformScriptSchema = z.object({ script: z.string() }).passthrough();
const scriptGroupSchema = z
  .object({
    script: z.string(),
    darwin: platformScriptSchema.optional(),
    linux: platformScriptSchema.optional(),
    win32: platformScriptSchema.optional(),
  })
  .passthrough();

const actionSchema = z
  .object({
    name: z.string().trim().min(1),
    icon: z.enum(["tool", "run", "debug", "test"]).optional(),
    command: z.string().trim().min(1),
    platform: platformSchema.optional(),
  })
  .passthrough();

const environmentConfigSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1),
    setup: scriptGroupSchema,
    cleanup: scriptGroupSchema.optional(),
    actions: z.array(actionSchema).default([]),
  })
  .passthrough();

export type EnvironmentConfig = z.infer<typeof environmentConfigSchema>;

export type ParsedEnvironmentConfig =
  | { ok: true; config: EnvironmentConfig }
  | { ok: false; error: string };

export function parseEnvironmentConfig(raw: string): ParsedEnvironmentConfig {
  try {
    const parsed = environmentConfigSchema.safeParse(parse(raw));
    if (parsed.success) return { ok: true, config: parsed.data };

    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      error: `${location}${issue?.message ?? "Invalid environment file"}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TOML",
    };
  }
}

export function scriptForPlatform(
  group: EnvironmentConfig["setup"] | EnvironmentConfig["cleanup"],
  platform: Platform,
): string {
  if (!group) return "";
  return group[platform]?.script ?? group.script;
}

export function actionsForPlatform(
  config: EnvironmentConfig,
  platform: Platform,
) {
  return config.actions.filter(
    (action) => action.platform === undefined || action.platform === platform,
  );
}

export function normalizeConfigPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized.startsWith(".codex/environments/") ||
    !normalized.endsWith(".toml") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    return null;
  }
  return normalized;
}

export function joinRemotePath(root: string, relativePath: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const remoteRelative = relativePath.replaceAll(/[\\/]/g, separator);
  return `${trimmedRoot}${separator}${remoteRelative}`;
}

export function configPathFromAbsolute(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const marker = "/.codex/environments/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  return normalizeConfigPath(normalized.slice(markerIndex + 1));
}
