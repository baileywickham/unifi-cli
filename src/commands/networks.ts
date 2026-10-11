import { randomInt } from "node:crypto";
import type { ApiClient } from "../api";
import type { Network, WifiBroadcast } from "../types";
import { json, table } from "../format";
import type { Confirm } from "./devices";

// --- IPv4 helpers --------------------------------------------------------

const toInt = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const toIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** Parse "192.168.20.1/24" (gateway address + prefix). */
export function parseGatewayCidr(input: string): { host: string; prefix: number; network: number; broadcast: number } {
  const m = input.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m || m[1].split(".").some((o) => Number(o) > 255)) {
    throw new Error(`invalid subnet "${input}" (gateway address and prefix, e.g. 192.168.20.1/24)`);
  }
  const prefix = Number(m[2]);
  if (prefix < 16 || prefix > 29) throw new Error(`prefix /${prefix} out of range (use /16 to /29)`);
  const size = 2 ** (32 - prefix);
  const host = toInt(m[1]);
  const network = host - (host % size);
  const broadcast = network + size - 1;
  if (host === network || host === broadcast) throw new Error(`${m[1]} is the network or broadcast address of /${prefix}`);
  return { host: m[1], prefix, network, broadcast };
}

function subnetOf(n: Network): { network: number; broadcast: number } | null {
  const v4 = n.ipv4Configuration;
  if (!v4?.hostIpAddress || !v4.prefixLength) return null;
  const { network, broadcast } = parseGatewayCidr(`${v4.hostIpAddress}/${v4.prefixLength}`);
  return { network, broadcast };
}

const cidr = (n: Network) =>
  n.ipv4Configuration ? `${n.ipv4Configuration.hostIpAddress}/${n.ipv4Configuration.prefixLength}` : "-";

// --- networks ------------------------------------------------------------

/** Full detail for every network (the list endpoint omits subnet and isolation). */
export async function listNetworksDetailed(client: ApiClient, siteId: string): Promise<Network[]> {
  const summaries = await client.listNetworkSummaries(siteId);
  return Promise.all(summaries.map((n) => client.getNetwork(siteId, n.id)));
}

export async function networksCommand(client: ApiClient, siteId: string, asJson: boolean): Promise<string> {
  const networks = await listNetworksDetailed(client, siteId);
  if (asJson) return json(networks);
  const yn = (v: boolean | undefined) => (v === undefined ? "-" : v ? "yes" : "no");
  return table(
    ["NAME", "VLAN", "SUBNET", "ISOLATED", "INTERNET", "ENABLED", "ID"],
    networks.map((n) => [n.name, String(n.vlanId), cidr(n), yn(n.isolationEnabled), yn(n.internetAccessEnabled), yn(n.enabled), n.id]),
  );
}

export function resolveNetwork(networks: Network[], ref: string): Network {
  const match = networks.filter((n) => n.id === ref || n.name.toLowerCase() === ref.toLowerCase());
  if (match.length === 1) return match[0];
  if (match.length === 0) throw new Error(`no network matching "${ref}" (have: ${networks.map((n) => n.name).join(", ")})`);
  throw new Error(`ambiguous network "${ref}": ids ${match.map((n) => n.id).join(", ")}`);
}

export interface NetworkCreateOptions {
  vlan: string | undefined;
  subnet: string | undefined;
  isolate: boolean;
  yes: boolean;
  confirm: Confirm;
}

/** Build the POST body for a gateway-managed VLAN with DHCP from .6 to the last usable address. */
export function networkBody(name: string, vlanId: number, subnet: string, isolate: boolean): Omit<Network, "id"> {
  const { host, prefix, network, broadcast } = parseGatewayCidr(subnet);
  return {
    management: "GATEWAY",
    name,
    enabled: true,
    vlanId,
    isolationEnabled: isolate,
    internetAccessEnabled: true,
    mdnsForwardingEnabled: !isolate,
    cellularBackupEnabled: false,
    ipv4Configuration: {
      autoScaleEnabled: false,
      hostIpAddress: host,
      prefixLength: prefix,
      dhcpConfiguration: {
        mode: "SERVER",
        ipAddressRange: { start: toIp(Math.min(network + 6, broadcast - 1)), stop: toIp(broadcast - 1) },
        leaseTimeSeconds: 86400,
        pingConflictDetectionEnabled: true,
      },
    },
  };
}

/**
 * Create a VLAN network. Refuses a name, VLAN ID or overlapping subnet that already
 * exists, then re-reads the network to report what the gateway actually stored.
 */
export async function networkCreateCommand(
  client: ApiClient,
  siteId: string,
  name: string,
  opts: NetworkCreateOptions,
): Promise<string> {
  if (name.length < 2 || name.length > 32) throw new Error(`network name must be 2-32 characters`);
  const vlanId = Number(opts.vlan);
  if (!Number.isInteger(vlanId) || vlanId < 2 || vlanId > 4009) throw new Error(`--vlan must be 2-4009 (got "${opts.vlan ?? ""}")`);
  if (!opts.subnet) throw new Error(`--subnet is required (e.g. 192.168.20.1/24)`);
  const body = networkBody(name, vlanId, opts.subnet, opts.isolate);
  const mine = parseGatewayCidr(opts.subnet);

  const existing = await listNetworksDetailed(client, siteId);
  for (const n of existing) {
    if (n.name.toLowerCase() === name.toLowerCase()) throw new Error(`a network named "${n.name}" already exists`);
    if (n.vlanId === vlanId) throw new Error(`VLAN ${vlanId} is already used by "${n.name}"`);
    const s = subnetOf(n);
    if (s && s.network <= mine.broadcast && mine.network <= s.broadcast) {
      throw new Error(`${opts.subnet} overlaps "${n.name}" (${cidr(n)})`);
    }
  }

  const range = body.ipv4Configuration!.dhcpConfiguration!.ipAddressRange!;
  const what = `network "${name}" (VLAN ${vlanId}, ${opts.subnet}, DHCP ${range.start}-${range.stop}, ${opts.isolate ? "isolated from other networks" : "NOT isolated"})`;
  if (!opts.yes && !(await opts.confirm(`Create ${what}?`))) return "aborted";
  const created = await client.createNetwork(siteId, body);
  const after = await client.getNetwork(siteId, created.id);
  if (after.isolationEnabled !== opts.isolate) {
    throw new Error(`network "${after.name}" was created (${after.id}) but isolation is ${after.isolationEnabled ? "on" : "off"}`);
  }
  return `created network "${after.name}": VLAN ${after.vlanId}, ${cidr(after)}, isolated ${after.isolationEnabled ? "yes" : "no"}, id ${after.id}`;
}

// --- wifi ----------------------------------------------------------------

const BANDS: Record<string, number[]> = { "2.4": [2.4], "5": [5], "6": [6], both: [2.4, 5] };

function wifiNetworkName(w: WifiBroadcast, networks: Network[]): string {
  if (w.network.type === "NATIVE") return networks.find((n) => n.default)?.name ?? "default";
  return networks.find((n) => n.id === w.network.networkId)?.name ?? w.network.networkId ?? "?";
}

export async function wifisCommand(client: ApiClient, siteId: string, asJson: boolean): Promise<string> {
  const [wifis, networks] = await Promise.all([client.listWifiBroadcasts(siteId), client.listNetworkSummaries(siteId)]);
  if (asJson) return json(wifis);
  return table(
    ["NAME", "ENABLED", "NETWORK", "SECURITY", "BANDS GHz", "ID"],
    wifis.map((w) => [
      w.name,
      w.enabled ? "yes" : "no",
      wifiNetworkName(w, networks),
      w.securityConfiguration?.type ?? "-",
      (w.broadcastingFrequenciesGHz ?? []).join(","),
      w.id,
    ]),
  );
}

/** 20 characters from an alphabet without look-alikes (0/O, 1/l/I), easy to type into a device app. */
export function generatePassphrase(length = 20): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export interface WifiCreateOptions {
  network: string | undefined;
  band: string | undefined;
  passphrase: string | undefined;
  yes: boolean;
  confirm: Confirm;
}

/** Create a WPA2-personal SSID on a network. Generates a passphrase if none is given and prints it once. */
export async function wifiCreateCommand(
  client: ApiClient,
  siteId: string,
  ssid: string,
  opts: WifiCreateOptions,
): Promise<string> {
  if (!opts.network) throw new Error(`--network is required`);
  const bandKey = opts.band ?? "2.4";
  const bands = BANDS[bandKey];
  if (!bands) throw new Error(`--band must be 2.4, 5, 6 or both (got "${bandKey}")`);
  const generated = opts.passphrase === undefined;
  const passphrase = opts.passphrase ?? generatePassphrase();
  if (passphrase.length < 8 || passphrase.length > 63) throw new Error(`passphrase must be 8-63 characters`);

  const [wifis, networks] = await Promise.all([client.listWifiBroadcasts(siteId), client.listNetworkSummaries(siteId)]);
  if (wifis.some((w) => w.name === ssid)) throw new Error(`an SSID named "${ssid}" already exists`);
  const network = resolveNetwork(networks, opts.network);

  if (!opts.yes && !(await opts.confirm(`Create WiFi "${ssid}" on network "${network.name}" (${bands.join("+")} GHz, WPA2)?`))) {
    return "aborted";
  }
  const created = await client.createWifiBroadcast(siteId, {
    type: "STANDARD",
    name: ssid,
    enabled: true,
    network: network.default ? { type: "NATIVE" } : { type: "SPECIFIC", networkId: network.id },
    securityConfiguration: { type: "WPA2_PERSONAL", passphrase, fastRoamingEnabled: false },
    broadcastingFrequenciesGHz: bands,
    // the gateway rejects the field entirely (even false) on a single-band SSID
    ...(bands.length > 1 ? { bandSteeringEnabled: true } : {}),
    multicastToUnicastConversionEnabled: false,
    clientIsolationEnabled: false,
    hideName: false,
    uapsdEnabled: false,
    bssTransitionEnabled: true,
    arpProxyEnabled: false,
    advertiseDeviceName: false,
  });
  const lines = [`created WiFi "${created.name}" on "${network.name}" (${bands.join("+")} GHz), id ${created.id}`];
  if (generated) lines.push(`passphrase: ${passphrase}`);
  return lines.join("\n");
}
