import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  gateway: string;
  apiKey: string;
  defaultSite?: string;
}

export class ConfigError extends Error {}

const KEY_HELP = `no API key found.

Create one in the UniFi UI: Settings → Control Plane → Integrations → Create API Key,
then either:
  export UNIFI_API_KEY=<key>   (and optionally UNIFI_GATEWAY=https://192.168.0.1)
or write ~/.config/unifi-cli/config.json:
  { "gateway": "https://192.168.0.1", "apiKey": "<key>" }`;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  configPath: string = join(homedir(), ".config", "unifi-cli", "config.json"),
): Config {
  let raw: string | undefined;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`could not read ${configPath}: ${(err as Error).message}`);
    }
  }
  let file: Partial<Config> = {};
  if (raw !== undefined) {
    try {
      file = JSON.parse(raw);
    } catch {
      throw new ConfigError(`invalid JSON in ${configPath}`);
    }
    if (typeof file !== "object" || file === null || Array.isArray(file)) {
      throw new ConfigError(`invalid config in ${configPath}: expected a JSON object`);
    }
  }
  const apiKey = env.UNIFI_API_KEY ?? file.apiKey;
  if (!apiKey) throw new ConfigError(KEY_HELP);
  return {
    gateway: (env.UNIFI_GATEWAY ?? file.gateway ?? "https://192.168.0.1").replace(/\/+$/, ""),
    apiKey,
    defaultSite: file.defaultSite,
  };
}
