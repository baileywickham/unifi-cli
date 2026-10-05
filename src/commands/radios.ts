import type { ApiClient } from "../api";
import type { LegacyDevice, LegacyRadio } from "../types";
import { json, table } from "../format";
import type { Confirm } from "./devices";

/** Band as the user types it ("2.4", "5", "6") → legacy `radio` code. */
const BANDS = {
  "2.4": { code: "ng", widths: [20, 40], channels: [1, 14] },
  "5": { code: "na", widths: [20, 40, 80, 160], channels: [32, 177] },
  "6": { code: "6e", widths: [20, 40, 80, 160, 320], channels: [1, 233] },
} as const;
type Band = keyof typeof BANDS;

const TX_POWER_MODES = ["auto", "low", "medium", "high"] as const;

export function bandLabel(radioCode: string): string {
  const band = (Object.keys(BANDS) as Band[]).find((b) => BANDS[b].code === radioCode);
  return band ? `${band} GHz` : radioCode;
}

/** Accepts 2.4/2/2g/2.4ghz, 5/5g/5ghz, 6/6e/6g/6ghz. */
export function parseBand(input: string): Band {
  const s = input.toLowerCase().replace(/\s+/g, "").replace(/ghz$/, "");
  if (["2.4", "2", "2g", "2.4g", "ng"].includes(s)) return "2.4";
  if (["5", "5g", "na"].includes(s)) return "5";
  if (["6", "6e", "6g"].includes(s)) return "6";
  throw new Error(`unknown band "${input}" (use 2.4, 5 or 6)`);
}

/** Match an AP by legacy `_id`, name (case-insensitive) or MAC. */
export function resolveLegacyDevice(devices: LegacyDevice[], ref: string): LegacyDevice {
  const r = ref.toLowerCase();
  const matches = devices.filter((d) => d._id === ref || d.name?.toLowerCase() === r || d.mac?.toLowerCase() === r);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`no device matching "${ref}"`);
  throw new Error(`ambiguous device "${ref}": ${matches.map((m) => `${m.name} ${m.mac}`).join(", ")}`);
}

export interface RadioRow {
  device: string;
  deviceId: string;
  mac: string;
  radio: string;
  band: string;
  configured: { channel: string; widthMHz: number | null; txPowerMode: string; txPower: string | null };
  current: {
    channel: number | null;
    widthMHz: number | null;
    txPower: number | null;
    clients: number | null;
    utilizationPct: number | null;
    retriesPct: number | null;
  };
}

const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function radioRows(devices: LegacyDevice[]): RadioRow[] {
  return devices.flatMap((d) =>
    (d.radio_table ?? []).map((r) => {
      const stats = d.radio_table_stats?.find((s) => s.name === r.name);
      return {
        device: d.name ?? d.mac,
        deviceId: d._id,
        mac: d.mac,
        radio: r.name,
        band: bandLabel(r.radio),
        configured: {
          channel: String(r.channel ?? "auto"),
          widthMHz: num(r.ht),
          txPowerMode: r.tx_power_mode ?? "auto",
          txPower: r.tx_power != null ? String(r.tx_power) : null,
        },
        current: {
          channel: num(stats?.channel),
          widthMHz: num(stats?.bw),
          txPower: num(stats?.tx_power),
          clients: num(stats?.num_sta),
          utilizationPct: num(stats?.cu_total),
          retriesPct: num(stats?.tx_retries_pct),
        },
      };
    }),
  );
}

export async function radiosCommand(
  client: ApiClient,
  siteRef: string,
  ref: string | undefined,
  asJson: boolean,
): Promise<string> {
  let devices = (await client.listLegacyDevices(siteRef)).filter((d) => (d.radio_table ?? []).length > 0);
  if (ref) devices = [resolveLegacyDevice(devices, ref)];
  const rows = radioRows(devices);
  if (asJson) return json(rows);
  const s = (v: number | null) => (v == null ? "-" : String(v));
  return table(
    ["DEVICE", "BAND", "RADIO", "CHANNEL", "CH NOW", "WIDTH", "WIDTH NOW", "TX POWER", "CLIENTS", "BUSY", "RETRIES"],
    rows.map((r) => [
      r.device,
      r.band,
      r.radio,
      r.configured.channel,
      s(r.current.channel),
      r.configured.widthMHz == null ? "-" : `${r.configured.widthMHz} MHz`,
      r.current.widthMHz == null ? "-" : `${r.current.widthMHz} MHz`,
      r.configured.txPowerMode === "custom" ? `custom (${r.configured.txPower ?? "?"} dBm)` : r.configured.txPowerMode,
      s(r.current.clients),
      r.current.utilizationPct == null ? "-" : `${r.current.utilizationPct}%`,
      r.current.retriesPct == null ? "-" : `${r.current.retriesPct}%`,
    ]),
  );
}

export interface RadioChanges {
  width?: string;
  channel?: string;
  txPower?: string;
}

/** Validate the requested changes for `band` and return the fields to set on the radio_table entry. */
export function radioPatch(band: Band, changes: RadioChanges): Partial<LegacyRadio> {
  const spec = BANDS[band];
  const patch: Partial<LegacyRadio> = {};
  if (changes.width !== undefined) {
    const w = Number(changes.width);
    if (!(spec.widths as readonly number[]).includes(w)) {
      throw new Error(`invalid width "${changes.width}" for ${band} GHz (allowed: ${spec.widths.join(", ")})`);
    }
    patch.ht = String(w);
  }
  if (changes.channel !== undefined) {
    const c = changes.channel.toLowerCase();
    if (c === "auto") patch.channel = "auto";
    else {
      const n = Number(c);
      const [lo, hi] = spec.channels;
      if (!Number.isInteger(n) || n < lo || n > hi) {
        throw new Error(`invalid channel "${changes.channel}" for ${band} GHz (use auto or ${lo}-${hi})`);
      }
      patch.channel = n;
    }
  }
  if (changes.txPower !== undefined) {
    const t = changes.txPower.toLowerCase();
    if (!(TX_POWER_MODES as readonly string[]).includes(t)) {
      throw new Error(`invalid --tx-power "${changes.txPower}" (use ${TX_POWER_MODES.join(", ")})`);
    }
    patch.tx_power_mode = t;
  }
  if (Object.keys(patch).length === 0) throw new Error("nothing to change: pass --width, --channel and/or --tx-power");
  return patch;
}

/** Human-readable before → after lines for the fields that actually change. */
export function radioDiff(before: LegacyRadio, patch: Partial<LegacyRadio>): string[] {
  const lines: string[] = [];
  if (patch.ht !== undefined && String(before.ht) !== String(patch.ht)) {
    lines.push(`width     ${before.ht ?? "?"} MHz → ${patch.ht} MHz`);
  }
  if (patch.channel !== undefined && String(before.channel ?? "auto") !== String(patch.channel)) {
    lines.push(`channel   ${before.channel ?? "auto"} → ${patch.channel}`);
  }
  if (patch.tx_power_mode !== undefined && (before.tx_power_mode ?? "auto") !== patch.tx_power_mode) {
    lines.push(`tx power  ${before.tx_power_mode ?? "auto"} → ${patch.tx_power_mode}`);
  }
  return lines;
}

/**
 * Change one radio's width/channel/tx power via the legacy API. The PUT must
 * carry the device's whole radio_table, so every other radio is sent back as-is.
 */
export async function radioSetCommand(
  client: ApiClient,
  siteRef: string,
  ref: string,
  bandInput: string,
  changes: RadioChanges,
  opts: { yes: boolean; confirm: Confirm },
): Promise<string> {
  const band = parseBand(bandInput);
  const patch = radioPatch(band, changes);
  const aps = (await client.listLegacyDevices(siteRef)).filter((d) => (d.radio_table ?? []).length > 0);
  const device = resolveLegacyDevice(aps, ref);
  const name = device.name ?? device.mac;
  const radios = device.radio_table ?? [];
  const idx = radios.findIndex((r) => r.radio === BANDS[band].code);
  if (idx === -1) {
    throw new Error(`${name} has no ${band} GHz radio (has: ${radios.map((r) => bandLabel(r.radio)).join(", ")})`);
  }
  const before = radios[idx];
  const diff = radioDiff(before, patch);
  const header = `${name} ${band} GHz (${before.name})`;
  if (diff.length === 0) return `${header}: already set, nothing to change`;
  const summary = [header, ...diff.map((l) => `  ${l}`)].join("\n");
  const warning = `Applying briefly drops clients on the ${band} GHz radio while it restarts.`;
  if (!opts.yes && !(await opts.confirm(`${summary}\n${warning}\nApply?`))) return "aborted";
  const updated = radios.map((r, i) => (i === idx ? { ...r, ...patch } : r));
  await client.updateRadioTable(siteRef, device._id, updated);
  return `${summary}\napplied. ${warning}`;
}
