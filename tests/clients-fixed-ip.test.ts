import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { Client, LegacyNetwork } from "../src/types";
import { resolveClient, networkForIp, fixedIpCommand, clientDetailCommand } from "../src/commands/clients";

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
