import type { ApiClient } from "../api";
import type { Device } from "../types";
import { json, table, formatUptime } from "../format";

export async function devicesCommand(client: ApiClient, siteId: string, asJson: boolean): Promise<string> {
  const devices = await client.listDevices(siteId);
  if (asJson) return json(devices);
  return table(
    ["NAME", "MODEL", "IP", "STATE", "FIRMWARE"],
    devices.map((d) => [d.name, d.model, d.ipAddress ?? "", d.state, d.firmwareVersion ?? ""]),
  );
}

export type Confirm = (message: string) => Promise<boolean>;

export function resolveDevice(devices: Device[], ref: string): Device {
  const byId = devices.find((d) => d.id === ref);
  if (byId) return byId;
  const matches = devices.filter((d) => d.name?.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`no device matching "${ref}"`);
  throw new Error(`ambiguous device "${ref}": ids ${matches.map((m) => m.id).join(", ")}`);
}

export async function deviceDetailCommand(
  client: ApiClient,
  siteId: string,
  ref: string,
  asJson: boolean,
): Promise<string> {
  const device = resolveDevice(await client.listDevices(siteId), ref);
  const [detail, stats] = await Promise.all([
    client.getDevice(siteId, device.id),
    client.getDeviceStats(siteId, device.id).catch(() => null),
  ]);
  if (asJson) return json({ ...detail, statistics: stats });
  const rows: [string, string][] = [
    ["id", detail.id],
    ["name", detail.name],
    ["model", detail.model],
    ["mac", detail.macAddress],
    ["ip", detail.ipAddress ?? ""],
    ["state", detail.state],
    ["firmware", detail.firmwareVersion ?? ""],
  ];
  if (stats?.uptimeSec != null) rows.push(["uptime", formatUptime(stats.uptimeSec)]);
  if (stats?.cpuUtilizationPct != null) rows.push(["cpu", `${stats.cpuUtilizationPct}%`]);
  if (stats?.memoryUtilizationPct != null) rows.push(["memory", `${stats.memoryUtilizationPct}%`]);
  return rows.map(([k, v]) => `${k.padEnd(10)}${v}`).join("\n");
}

export async function restartCommand(
  client: ApiClient,
  siteId: string,
  ref: string,
  opts: { yes: boolean; confirm: Confirm },
): Promise<string> {
  const device = resolveDevice(await client.listDevices(siteId), ref);
  const prompt = `Restart ${device.name} (${device.model}, ${device.ipAddress})?`;
  if (!opts.yes && !(await opts.confirm(prompt))) return "aborted";
  await client.restartDevice(siteId, device.id);
  return `restart requested for ${device.name}`;
}

export async function powerCycleCommand(
  client: ApiClient,
  siteId: string,
  ref: string,
  portIdx: number,
  opts: { yes: boolean; confirm: Confirm },
): Promise<string> {
  const device = resolveDevice(await client.listDevices(siteId), ref);
  const prompt = `Power-cycle port ${portIdx} on ${device.name} (${device.model})?`;
  if (!opts.yes && !(await opts.confirm(prompt))) return "aborted";
  await client.powerCyclePort(siteId, device.id, portIdx);
  return `power-cycle requested for port ${portIdx} on ${device.name}`;
}
