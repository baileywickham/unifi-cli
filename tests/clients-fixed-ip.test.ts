import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { Client, LegacyNetwork } from "../src/types";
import { resolveClient, networkForIp, fixedIpCommand, clientDetailCommand, clientsCommand } from "../src/commands/clients";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;

const CLIENTS: Client[] = [
  { id: "c1", name: "Mac f0:6f", type: "WIRELESS", ipAddress: "192.168.0.134", macAddress: "02:9b:56:70:f0:6f" },
  { id: "c2", name: "iPhone", type: "WIRELESS", ipAddress: "192.168.0.190", macAddress: "06:76:64:8e:9e:7c" },
];
const USERS = [{ _id: "u1", mac: "02:9B:56:70:F0:6F", hostname: "Mac" }];
const NETWORKS: LegacyNetwork[] = [
  { _id: "n-wan", name: "Internet 1", purpose: "wan" },
  { _id: "n-lan", name: "Default", purpose: "corporate", ip_subnet: "192.168.0.1/24" },
];

test("resolveClient matches id, name, ip, mac (case-insensitive)", () => {
  expect(resolveClient(CLIENTS, "c2").name).toBe("iPhone");
  expect(resolveClient(CLIENTS, "mac f0:6f").id).toBe("c1");
  expect(resolveClient(CLIENTS, "192.168.0.134").id).toBe("c1");
  expect(resolveClient(CLIENTS, "02:9B:56:70:F0:6F").id).toBe("c1");
  expect(() => resolveClient(CLIENTS, "nope")).toThrow(/no connected client/);
});

test("networkForIp picks the LAN containing the address", () => {
  expect(networkForIp(NETWORKS, "192.168.0.50")._id).toBe("n-lan");
  expect(() => networkForIp(NETWORKS, "10.0.0.5")).toThrow(/no network contains/);
  expect(() => networkForIp(NETWORKS, "300.1.1.1")).toThrow(/not an IPv4/);
});

test("fixedIpCommand reserves, names, and clears", async () => {
  const puts: unknown[] = [];
  const client = stub({
    listClients: async () => CLIENTS,
    listUsers: async () => USERS,
    listNetworks: async () => NETWORKS,
    updateUser: async (_s: string, id: string, patch: unknown) => void puts.push([id, patch]),
  });
  const declined = await fixedIpCommand(client, "s", "default", "192.168.0.134", "192.168.0.50", { yes: false, confirm: async () => false });
  expect(declined).toBe("aborted");
  expect(puts).toHaveLength(0);
  const out = await fixedIpCommand(client, "s", "default", "192.168.0.134", "192.168.0.50", { yes: true, confirm: async () => false, name: "macnode" });
  expect(out).toContain("reserved 192.168.0.50");
  expect(puts[0]).toEqual(["u1", { use_fixedip: true, fixed_ip: "192.168.0.50", network_id: "n-lan", name: "macnode" }]);
  await fixedIpCommand(client, "s", "default", "c1", "off", { yes: true, confirm: async () => true });
  expect(puts[1]).toEqual(["u1", { use_fixedip: false }]);
  await expect(fixedIpCommand(client, "s", "default", "iPhone", "192.168.0.51", { yes: true, confirm: async () => true })).rejects.toThrow(/no record/);
});

test("clientDetailCommand shows the reservation", async () => {
  const client = stub({
    listClients: async () => CLIENTS,
    listUsers: async () => [{ ...USERS[0], use_fixedip: true, fixed_ip: "192.168.0.50" }],
  });
  const out = await clientDetailCommand(client, "s", "default", "Mac f0:6f", false);
  expect(out).toContain("fixed ip  192.168.0.50");
  const j = JSON.parse(await clientDetailCommand(client, "s", "default", "c1", true));
  expect(j.reservation.fixed_ip).toBe("192.168.0.50");
});

// Known-client records as GET /rest/user returns them (trimmed).
const KNOWN = [
  { _id: "u1", mac: "02:9b:56:70:f0:6f", hostname: "Mac", name: "macnode", last_ip: "192.168.0.50", first_seen: 1774629026, last_seen: 1790986688, is_wired: false, use_fixedip: true, fixed_ip: "192.168.0.50" },
  { _id: "u2", mac: "aa:bb:cc:00:00:01", hostname: "printer", oui: "Brother", last_ip: "192.168.0.77", first_seen: 1774629026, last_seen: 1791000000, is_wired: true },
  { _id: "u3", mac: "aa:bb:cc:00:00:02", hostname: "old-tv", last_ip: "192.168.0.77", first_seen: 1774000000, last_seen: 1780000000, is_wired: false },
];

test("clientDetailCommand falls back to known offline clients", async () => {
  const client = stub({ listClients: async () => CLIENTS, listUsers: async () => KNOWN });
  const out = await clientDetailCommand(client, "s", "default", "printer", false);
  expect(out).toMatch(/^status\s+offline$/m);
  expect(out).toMatch(/^vendor\s+Brother$/m);
  expect(out).toMatch(/^type\s+WIRED$/m);
  expect(out).toMatch(/^first seen\s+2026-03-27T16:30:26Z$/m);
  expect(out).toMatch(/^last seen\s+2026-10-03T04:00:00Z$/m);
  // an IP reused over time lists every known client that had it, newest first
  const both = await clientDetailCommand(client, "s", "default", "192.168.0.77", false);
  expect(both.indexOf("printer")).toBeLessThan(both.indexOf("old-tv"));
  // a match that is connected under another IP says so
  const mac = await clientDetailCommand(client, "s", "default", "macnode", false);
  expect(mac).toMatch(/^status\s+connected now as 192\.168\.0\.134$/m);
  const j = JSON.parse(await clientDetailCommand(client, "s", "default", "aa:bb:cc:00:00:01", true));
  expect(j).toEqual([{ ...KNOWN[1], connected: false }]);
  await expect(clientDetailCommand(client, "s", "default", "nope", false)).rejects.toThrow(/connected or known/);
});

test("clientsCommand --all appends offline known clients", async () => {
  const seen: string[] = [];
  const client = stub({ listClients: async () => CLIENTS, listUsers: async (ref: string) => (seen.push(ref), KNOWN) });
  const out = await clientsCommand(client, "s", { wired: false, wireless: false, json: false, all: true, siteRef: "default" });
  expect(seen).toEqual(["default"]);
  expect(out).toMatch(/printer\s+192\.168\.0\.77\s+aa:bb:cc:00:00:01\s+WIRED\s+offline, last seen 2026-10-03T04:00:00Z/);
  expect(out).not.toMatch(/macnode/); // connected (as "Mac f0:6f"), so not repeated as offline
  const wireless = await clientsCommand(client, "s", { wired: false, wireless: true, json: false, all: true });
  expect(wireless).toContain("old-tv");
  expect(wireless).not.toContain("printer");
  const j = JSON.parse(await clientsCommand(client, "s", { wired: false, wireless: false, json: true, all: true }));
  expect(j.connected).toHaveLength(2);
  expect(j.offline.map((u: { _id: string }) => u._id)).toEqual(["u2", "u3"]);
  // without --all the legacy API is not touched
  seen.length = 0;
  await clientsCommand(client, "s", { wired: false, wireless: false, json: false });
  expect(seen).toEqual([]);
});
