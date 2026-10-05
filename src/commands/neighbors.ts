import type { ApiClient } from "../api";
import type { LegacyNeighbor } from "../types";
import { json, table } from "../format";
import { bandLabel, parseBand } from "./radios";

const BAND_CODES = { "2.4": "ng", "5": "na", "6": "6e" } as const;

export interface ChannelRow {
  band: string;
  channel: number;
  networks: number;
  strongest: number | null; // dBm
  strongNetworks: number; // signal >= -75 dBm, loud enough to cost airtime
}

export const STRONG_DBM = -75;

/** Group neighbors by band + primary channel, busiest band/channel first within each band. */
export function channelRows(neighbors: LegacyNeighbor[]): ChannelRow[] {
  const groups = new Map<string, LegacyNeighbor[]>();
  for (const n of neighbors) {
    const key = `${n.band}:${n.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups.values()]
    .map((g) => {
      const signals = g.map((n) => n.signal).filter((v): v is number => typeof v === "number");
      return {
        band: bandLabel(g[0].band),
        channel: g[0].channel,
        networks: g.length,
        strongest: signals.length ? Math.max(...signals) : null,
        strongNetworks: signals.filter((v) => v >= STRONG_DBM).length,
      };
    })
    .sort((a, b) => a.band.localeCompare(b.band) || a.channel - b.channel);
}

/**
 * Neighboring Wi-Fi networks as heard by our APs (`/stat/rogueap`). An AP only
 * hears its own operating channel unless it runs a scan, so channels missing
 * here are unknown, not necessarily empty.
 */
export async function neighborsCommand(
  client: ApiClient,
  siteRef: string,
  opts: { band?: string; hours?: number; json: boolean },
): Promise<string> {
  let neighbors = await client.listNeighbors(siteRef, opts.hours ?? 1);
  if (opts.band) {
    const code = BAND_CODES[parseBand(opts.band)];
    neighbors = neighbors.filter((n) => n.band === code);
  }
  const rows = channelRows(neighbors);
  if (opts.json) return json({ channels: rows, neighbors });
  if (rows.length === 0) return "no neighboring networks heard";
  const out = table(
    ["BAND", "CHANNEL", "NETWORKS", "STRONGEST", `≥ ${STRONG_DBM} dBm`],
    rows.map((r) => [r.band, String(r.channel), String(r.networks), r.strongest == null ? "-" : `${r.strongest} dBm`, String(r.strongNetworks)]),
  );
  return `${out}\n\nAPs only hear the channel they're on; unlisted channels weren't scanned, not necessarily empty.`;
}
