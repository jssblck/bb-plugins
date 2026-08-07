import { describe, expect, it } from "vitest";
import {
  actionsForPlatform,
  configPathFromAbsolute,
  joinRemotePath,
  normalizeConfigPath,
  parseEnvironmentConfig,
  scriptForPlatform,
} from "./environment-config";

const raw = `
version = 1
name = "web"

[setup]
script = "npm install"

[setup.darwin]
script = "brew bundle"

[cleanup]
script = "docker compose down"

[[actions]]
name = "Run"
icon = "run"
command = "npm run dev"

[[actions]]
name = "macOS debug"
icon = "debug"
command = "npm run debug"
platform = "darwin"
`;

describe("parseEnvironmentConfig", () => {
  it("parses the Codex version 1 format", () => {
    const parsed = parseEnvironmentConfig(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.config.name).toBe("web");
    expect(scriptForPlatform(parsed.config.setup, "darwin")).toBe(
      "brew bundle",
    );
    expect(scriptForPlatform(parsed.config.setup, "linux")).toBe(
      "npm install",
    );
    expect(actionsForPlatform(parsed.config, "linux")).toHaveLength(1);
    expect(actionsForPlatform(parsed.config, "darwin")).toHaveLength(2);
  });

  it("rejects unsupported versions", () => {
    const parsed = parseEnvironmentConfig(raw.replace("version = 1", "version = 2"));
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("remote paths", () => {
  it("keeps project-relative environment paths confined", () => {
    expect(normalizeConfigPath(".codex/environments/web.toml")).toBe(
      ".codex/environments/web.toml",
    );
    expect(normalizeConfigPath(".codex/environments/../config.toml")).toBeNull();
  });

  it("supports POSIX and Windows hosts", () => {
    expect(joinRemotePath("/repo", ".codex/environments/web.toml")).toBe(
      "/repo/.codex/environments/web.toml",
    );
    expect(joinRemotePath("C:\\repo", ".codex/environments/web.toml")).toBe(
      "C:\\repo\\.codex\\environments\\web.toml",
    );
    expect(configPathFromAbsolute("C:\\repo\\.codex\\environments\\web.toml")).toBe(
      ".codex/environments/web.toml",
    );
  });
});
