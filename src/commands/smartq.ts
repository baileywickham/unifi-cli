import type { ApiClient } from "../api";
import type { LegacyNetwork } from "../types";
import { json, table } from "../format";
import type { Confirm } from "./devices";

export interface SmartqRow {
  wan: string;
  networkId: string;
  group: string | null;
  enabled: boolean;
  downMbps: number | null;
  upMbps: number | null;
}

const mbps = (kbps: unknown) => (typeof kbps === "number" ? kbps / 1000 : null);

export function smartqRows(networks: LegacyNetwork[]): SmartqRow[] {
  return networks
    .filter((n) => n.purpose === "wan")
    .map((n) => ({
      wan: n.name,
      networkId: n._id,
      group: n.wan_networkgroup ?? null,
      enabled: n.wan_smartq_enabled === true,
      downMbps: mbps(n.wan_smartq_down_rate),
      upMbps: mbps(n.wan_smartq_up_rate),
    }));
}

/** Pick a WAN by name, id or group ("WAN", "WAN2"); defaults to the primary WAN. */
export function resolveWan(networks: LegacyNetwork[], ref: string | undefined): LegacyNetwork {
  const wans = networks.filter((n) => n.purpose === "wan");
  if (wans.length === 0) throw new Error("gateway has no WAN networks");
  if (!ref) return wans.find((n) => n.wan_networkgroup === "WAN") ?? wans[0];
  const r = ref.toLowerCase();
  const match = wans.find(
    (n) => n._id === ref || n.name.toLowerCase() === r || n.wan_networkgroup?.toLowerCase() === r,
  );
  if (!match) throw new Error(`no WAN matching "${ref}" (have: ${wans.map((w) => w.name).join(", ")})`);
  return match;
}

export async function smartqCommand(client: ApiClient, siteRef: string, asJson: boolean): Promise<string> {
  const rows = smartqRows(await client.listNetworks(siteRef));
  if (asJson) return json(rows);
  const s = (v: number | null) => (v == null ? "-" : `${v} Mbps`);
  return table(
    ["WAN", "GROUP", "SMART QUEUES", "DOWN", "UP"],
    rows.map((r) => [r.wan, r.group ?? "-", r.enabled ? "on" : "off", s(r.downMbps), s(r.upMbps)]),
  );
}

/** Parse a rate in Mbps ("36", "36.5") to whole kbps. */
export function parseMbps(input: string, label: string): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) throw new Error(`invalid ${label} rate "${input}" (Mbps, e.g. 36)`);
  return Math.round(n * 1000);
}

/**
 * Turn Smart Queues on with the given rates (Mbps), or off (`rates` null).
 * The PUT carries the whole WAN network object with only the smartq fields changed.
 */
export async function smartqSetCommand(
  client: ApiClient,
  siteRef: string,
  rates: { down: string; up: string } | null,
  opts: { wan?: string; yes: boolean; confirm: Confirm },
): Promise<string> {
  const wan = resolveWan(await client.listNetworks(siteRef), opts.wan);
  const before = smartqRows([wan])[0];
  const patch: Partial<LegacyNetwork> = rates
    ? {
        wan_smartq_enabled: true,
        wan_smartq_down_rate: parseMbps(rates.down, "download"),
        wan_smartq_up_rate: parseMbps(rates.up, "upload"),
      }
    : { wan_smartq_enabled: false };
  const after = smartqRows([{ ...wan, ...patch }])[0];
  const fmt = (r: SmartqRow) => (r.enabled ? `on (down ${r.downMbps} Mbps, up ${r.upMbps} Mbps)` : "off");
  if (fmt(before) === fmt(after)) return `${wan.name}: Smart Queues already ${fmt(after)}`;
  const summary = `${wan.name} Smart Queues: ${fmt(before)} → ${fmt(after)}`;
  const note = "Set rates ~90% of measured speeds. Smart Queues caps throughput at these rates.";
  if (!opts.yes && !(await opts.confirm(`${summary}\n${note}\nApply?`))) return "aborted";
  await client.updateNetwork(siteRef, { ...wan, ...patch });
  return `${summary}\napplied.`;
}
