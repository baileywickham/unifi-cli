import type { ApiClient } from "../api";
import type { Client, LegacyNetwork, LegacyUser } from "../types";
import { formatUnixTime, json, table } from "../format";
import type { Confirm } from "./devices";

const userType = (u: LegacyUser) => (u.is_wired === undefined ? "" : u.is_wired ? "WIRED" : "WIRELESS");

/** Known clients (legacy /rest/user) that are not connected right now, most recently seen first. */
export function offlineUsers(users: LegacyUser[], connected: Client[]): LegacyUser[] {
  const online = new Set(connected.map((c) => c.macAddress?.toLowerCase()).filter(Boolean));
  return users
    .filter((u) => !online.has(u.mac.toLowerCase()))
    .sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0));
}

export async function clientsCommand(
  client: ApiClient,
  siteId: string,
  opts: { wired: boolean; wireless: boolean; json: boolean; all?: boolean; siteRef?: string },
): Promise<string> {
  if (opts.wired && opts.wireless) throw new Error("--wired and --wireless are mutually exclusive");
  const keep = (type: string) => (!opts.wired || type === "WIRED") && (!opts.wireless || type === "WIRELESS");
  const connected = await client.listClients(siteId);
  const clients = connected.filter((c) => keep(c.type));
  const offline = opts.all
    ? offlineUsers(await client.listUsers(opts.siteRef ?? "default"), connected).filter((u) => keep(userType(u)))
    : [];
  if (opts.json) return json(opts.all ? { connected: clients, offline } : clients);
  return table(
    ["NAME", "IP", "MAC", "TYPE", "CONNECTED"],
    [
      ...clients.map((c) => [c.name ?? "", c.ipAddress ?? "", c.macAddress ?? "", c.type, c.connectedAt ?? ""]),
      ...offline.map((u) => [
        u.name ?? u.hostname ?? "",
        u.last_ip ?? "",
        u.mac,
        userType(u),
        `offline, last seen ${formatUnixTime(u.last_seen) || "?"}`,
      ]),
    ],
  );
}

/** Match a connected client by id, name (case-insensitive), IP or MAC. */
export function matchClients(clients: Client[], ref: string): Client[] {
  const r = ref.toLowerCase();
  return clients.filter(
    (c) => c.id === ref || c.name?.toLowerCase() === r || c.ipAddress === ref || c.macAddress?.toLowerCase() === r,
  );
}

export function resolveClient(clients: Client[], ref: string): Client {
  const matches = matchClients(clients, ref);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`no connected client matching "${ref}" (try an IP or MAC from \`unifi clients\`)`);
  throw new Error(`ambiguous client "${ref}": ${matches.map((m) => `${m.name} ${m.ipAddress}`).join(", ")}`);
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`not an IPv4 address: ${ip}`);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Pick the LAN network whose subnet contains `ip`. */
export function networkForIp(networks: LegacyNetwork[], ip: string): LegacyNetwork {
  const want = ipv4ToInt(ip);
  for (const n of networks) {
    if (!n.ip_subnet) continue;
    const [addr, bits] = n.ip_subnet.split("/");
    const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    if ((ipv4ToInt(addr) & mask) === (want & mask)) return n;
  }
  throw new Error(`no network contains ${ip} (networks: ${networks.filter((n) => n.ip_subnet).map((n) => `${n.name} ${n.ip_subnet}`).join(", ")})`);
}

/** Match a known (legacy /rest/user) client by id, name or hostname (case-insensitive), last IP or MAC. */
export function matchKnownClients(users: LegacyUser[], ref: string): LegacyUser[] {
  const r = ref.toLowerCase();
  return users.filter(
    (u) =>
      u._id === ref ||
      u.name?.toLowerCase() === r ||
      u.hostname?.toLowerCase() === r ||
      u.last_ip === ref ||
      u.mac.toLowerCase() === r,
  );
}

/**
 * Nothing connected matches `ref`: show every known client that does, with
 * first/last seen. A match may still be connected under another IP or name.
 */
function knownClientDetail(users: LegacyUser[], connected: Client[], ref: string, asJson: boolean): string {
  const known = matchKnownClients(users, ref).sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0));
  if (known.length === 0) {
    throw new Error(`no client matching "${ref}", connected or known (try an IP or MAC from \`unifi clients --all\`)`);
  }
  const now = (u: LegacyUser) => connected.find((c) => c.macAddress?.toLowerCase() === u.mac.toLowerCase());
  if (asJson) return json(known.map((u) => ({ ...u, connected: now(u) !== undefined })));
  return known
    .map((u) => {
      const c = now(u);
      const rows: [string, string][] = [
        ["id", u._id],
        ["name", u.name ?? ""],
        ["hostname", u.hostname ?? ""],
        ["mac", u.mac],
        ["vendor", u.oui ?? ""],
        ["type", userType(u)],
        ["status", c ? `connected now as ${c.ipAddress ?? "no ip"}` : "offline"],
        ["last ip", u.last_ip ?? ""],
        ["first seen", formatUnixTime(u.first_seen)],
        ["last seen", formatUnixTime(u.last_seen)],
        ["fixed ip", u.use_fixedip && u.fixed_ip ? u.fixed_ip : "none"],
      ];
      return rows.map(([k, v]) => `${k.padEnd(11)}${v}`).join("\n");
    })
    .join("\n\n");
}

export async function clientDetailCommand(client: ApiClient, siteId: string, siteRef: string, ref: string, asJson: boolean): Promise<string> {
  const [connected, users] = await Promise.all([client.listClients(siteId), client.listUsers(siteRef)]);
  if (matchClients(connected, ref).length === 0) return knownClientDetail(users, connected, ref, asJson);
  const c = resolveClient(connected, ref);
  const user = users.find((u) => u.mac.toLowerCase() === c.macAddress?.toLowerCase());
  if (asJson) return json({ ...c, reservation: user ?? null });
  const rows: [string, string][] = [
    ["id", c.id],
    ["name", c.name ?? ""],
    ["ip", c.ipAddress ?? ""],
    ["mac", c.macAddress ?? ""],
    ["type", c.type],
    ["connected", c.connectedAt ?? ""],
    ["fixed ip", user?.use_fixedip && user.fixed_ip ? user.fixed_ip : "none"],
  ];
  return rows.map(([k, v]) => `${k.padEnd(10)}${v}`).join("\n");
}

/**
 * Set or clear a DHCP reservation. `ip` = "off" clears it. Takes effect at the
 * client's next DHCP renewal (reconnect it, or `ipconfig set en0 DHCP` on a Mac).
 */
export async function fixedIpCommand(
  client: ApiClient,
  siteId: string,
  siteRef: string,
  ref: string,
  ip: string,
  opts: { yes: boolean; confirm: Confirm; name?: string },
): Promise<string> {
  const c = resolveClient(await client.listClients(siteId), ref);
  const mac = c.macAddress?.toLowerCase();
  if (!mac) throw new Error(`client ${c.id} has no MAC address`);
  const user = (await client.listUsers(siteRef)).find((u) => u.mac.toLowerCase() === mac);
  if (!user) throw new Error(`the controller has no record for ${mac}; it must have connected at least once`);
  const label = `${c.name ?? mac} (${mac}, currently ${c.ipAddress ?? "no ip"})`;
  if (ip === "off") {
    if (!opts.yes && !(await opts.confirm(`Remove the fixed IP for ${label}?`))) return "aborted";
    await client.updateUser(siteRef, user._id, { use_fixedip: false });
    return `fixed IP removed for ${label}`;
  }
  const network = networkForIp(await client.listNetworks(siteRef), ip);
  const patch: Record<string, unknown> = { use_fixedip: true, fixed_ip: ip, network_id: network._id };
  if (opts.name) patch.name = opts.name;
  const prompt = `Reserve ${ip} (${network.name}) for ${label}? Applies at the client's next DHCP renewal.`;
  if (!opts.yes && !(await opts.confirm(prompt))) return "aborted";
  await client.updateUser(siteRef, user._id, patch);
  return `reserved ${ip} for ${label}${opts.name ? ` as "${opts.name}"` : ""}; reconnect the client to pick it up`;
}
