#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config";
import { ApiClient } from "./api";
import type { Site } from "./types";
import { infoCommand } from "./commands/info";
import { sitesCommand } from "./commands/sites";
import {
  devicesCommand,
  deviceDetailCommand,
  restartCommand,
  powerCycleCommand,
  type Confirm,
} from "./commands/devices";
import { clientsCommand, clientDetailCommand, fixedIpCommand } from "./commands/clients";

export const USAGE = `usage: unifi <command> [options]

commands:
  info                                  gateway application info
  sites                                 list sites
  devices                               list UniFi devices
  device <name|id>                      device detail + stats
  device restart <name|id>              restart a device
  device power-cycle <name|id> <port>   power-cycle a PoE port
  clients [--wired|--wireless]          list connected clients
  client <name|ip|mac>                  one client + its DHCP reservation
  client fixed-ip <client> <ip|off>     set/clear a DHCP reservation (--name N to label it)

options:
  --json          raw JSON output
  --site <name>   site to use (default: config defaultSite or first site)
  --yes           skip confirmation on write actions
  --name <label>  with fixed-ip: name the client in the controller
  -h, --help      show this help`;

async function resolveSite(client: ApiClient, requested: string | undefined): Promise<Site> {
  const sites = await client.listSites();
  if (sites.length === 0) throw new Error("gateway returned no sites");
  if (!requested) return sites[0];
  const match = sites.find((s) => s.id === requested || s.name?.toLowerCase() === requested.toLowerCase());
  if (!match) throw new Error(`no site matching "${requested}" (available: ${sites.map((s) => s.name).join(", ")})`);
  return match;
}

async function resolveSiteId(client: ApiClient, requested: string | undefined): Promise<string> {
  return (await resolveSite(client, requested)).id;
}

export async function run(
  argv: string[],
  client: ApiClient,
  defaultSite: string | undefined,
  confirm: Confirm,
): Promise<string> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      site: { type: "string" },
      yes: { type: "boolean", default: false },
      name: { type: "string" },
      wired: { type: "boolean", default: false },
      wireless: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) return USAGE;

  switch (command) {
    case "info":
      return infoCommand(client, values.json);
    case "sites":
      return sitesCommand(client, values.json);
    case "devices":
      return devicesCommand(client, await resolveSiteId(client, values.site ?? defaultSite), values.json);
    case "clients":
      return clientsCommand(client, await resolveSiteId(client, values.site ?? defaultSite), {
        wired: values.wired,
        wireless: values.wireless,
        json: values.json,
      });
    case "client": {
      const site = await resolveSite(client, values.site ?? defaultSite);
      const siteRef = site.internalReference ?? "default";
      const [sub, ...more] = rest;
      if (sub === "fixed-ip") {
        if (!more[0] || !more[1]) throw new Error(`usage: unifi client fixed-ip <name|ip|mac> <ip|off> [--name label]`);
        return fixedIpCommand(client, site.id, siteRef, more[0], more[1], { yes: values.yes, confirm, name: values.name });
      }
      if (!sub) throw new Error(`usage: unifi client <name|ip|mac>`);
      return clientDetailCommand(client, site.id, siteRef, sub, values.json);
    }
    case "device": {
      const siteId = await resolveSiteId(client, values.site ?? defaultSite);
      const [sub, ...more] = rest;
      if (sub === "restart") {
        if (!more[0]) throw new Error(`usage: unifi device restart <name|id>`);
        return restartCommand(client, siteId, more[0], { yes: values.yes, confirm });
      }
      if (sub === "power-cycle") {
        const port = Number(more[1]);
        if (!more[0] || !Number.isInteger(port)) {
          throw new Error(`usage: unifi device power-cycle <name|id> <port>`);
        }
        return powerCycleCommand(client, siteId, more[0], port, { yes: values.yes, confirm });
      }
      if (!sub) throw new Error(`usage: unifi device <name|id>`);
      return deviceDetailCommand(client, siteId, sub, values.json);
    }
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

async function ttyConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  try {
    const config = loadConfig();
    const client = new ApiClient(config.gateway, config.apiKey);
    console.log(await run(args, client, config.defaultSite, ttyConfirm));
  } catch (err) {
    console.error(`unifi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
