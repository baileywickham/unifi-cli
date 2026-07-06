import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError } from "../src/config";

const MISSING = join(tmpdir(), "does-not-exist", "config.json");

function tempConfig(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "unifi-cli-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, contents);
  return path;
}

test("env vars take precedence over file", () => {
  const path = tempConfig(JSON.stringify({ gateway: "https://file", apiKey: "filekey" }));
  const config = loadConfig({ UNIFI_API_KEY: "envkey", UNIFI_GATEWAY: "https://env" }, path);
  expect(config.apiKey).toBe("envkey");
  expect(config.gateway).toBe("https://env");
});

test("falls back to config file, keeps defaultSite", () => {
  const path = tempConfig(JSON.stringify({ apiKey: "filekey", defaultSite: "home" }));
  const config = loadConfig({}, path);
  expect(config.apiKey).toBe("filekey");
  expect(config.defaultSite).toBe("home");
});

test("gateway defaults to 192.168.0.1 and trailing slash is stripped", () => {
  expect(loadConfig({ UNIFI_API_KEY: "k" }, MISSING).gateway).toBe("https://192.168.0.1");
  expect(loadConfig({ UNIFI_API_KEY: "k", UNIFI_GATEWAY: "https://gw/" }, MISSING).gateway).toBe("https://gw");
});

test("missing key throws ConfigError with instructions", () => {
  expect(() => loadConfig({}, MISSING)).toThrow(ConfigError);
  expect(() => loadConfig({}, MISSING)).toThrow(/Integrations/);
});

test("invalid JSON throws ConfigError", () => {
  const path = tempConfig("{nope");
  expect(() => loadConfig({}, path)).toThrow(ConfigError);
});

test("non-object JSON config throws ConfigError", () => {
  expect(() => loadConfig({}, tempConfig("null"))).toThrow(ConfigError);
  expect(() => loadConfig({}, tempConfig("[1,2]"))).toThrow(ConfigError);
});
