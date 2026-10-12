import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { Network, WifiBroadcast } from "../src/types";
import {
  generatePassphrase,
  networkBody,
  networkCreateCommand,
  networksCommand,
  parseGatewayCidr,
  wifiCreateCommand,
  wifisCommand,
  wifiPassphraseCommand,
} from "../src/commands/networks";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;
const yes = async () => true;

// Shape observed on Network 10.6 (GET /integration/v1/sites/{id}/networks/{id}).
const DEFAULT: Network = {
  id: "net-default",
  name: "Default",
  management: "GATEWAY",
  enabled: true,
  vlanId: 1,
  default: true,
  isolationEnabled: false,
  internetAccessEnabled: true,
  ipv4Configuration: { hostIpAddress: "192.168.0.1", prefixLength: 24 },
};
const WIFI: WifiBroadcast = {
  id: "w1",
  type: "STANDARD",
  name: "wifi one",
  enabled: true,
  network: { type: "NATIVE" },
  securityConfiguration: { type: "WPA2_PERSONAL" },
  broadcastingFrequenciesGHz: [5, 2.4],
};

/** A fake gateway that stores networks and SSIDs and applies POSTs. */
function gateway(networks: Network[] = [DEFAULT], wifis: WifiBroadcast[] = [WIFI]) {
  const nets = networks.map((n) => ({ ...n }));
  const ssids = wifis.map((w) => ({ ...w }));
  const posts: unknown[] = [];
  const client = stub({
    listNetworkSummaries: async () => nets.map(({ id, name, vlanId, enabled, management, default: d }) => ({ id, name, vlanId, enabled, management, default: d })),
    getNetwork: async (_s: string, id: string) => ({ ...nets.find((n) => n.id === id)! }),
    createNetwork: async (_s: string, body: Omit<Network, "id">) => {
      posts.push(body);
      const n = { ...body, id: `net-${nets.length}` } as Network;
      nets.push(n);
      return n;
    },
    listWifiBroadcasts: async () => ssids.map((w) => ({ ...w })),
    createWifiBroadcast: async (_s: string, body: Record<string, unknown>) => {
      posts.push(body);
      const w = { ...body, id: `w${ssids.length + 1}` } as unknown as WifiBroadcast;
      ssids.push(w);
      return w;
    },
  });
  return { client, posts, nets };
}

test("parseGatewayCidr validates and finds network/broadcast", () => {
  const c = parseGatewayCidr("192.168.20.1/24");
  expect(c.prefix).toBe(24);
  expect(c.broadcast - c.network).toBe(255);
  expect(() => parseGatewayCidr("192.168.20.0/24")).toThrow(/network or broadcast/);
  expect(() => parseGatewayCidr("192.168.20.1")).toThrow(/invalid subnet/);
  expect(() => parseGatewayCidr("192.168.300.1/24")).toThrow(/invalid subnet/);
  expect(() => parseGatewayCidr("10.0.0.1/8")).toThrow(/out of range/);
});

test("networkBody: DHCP .6 to last usable, mDNS off when isolated", () => {
  const b = networkBody("IoT", 20, "192.168.20.1/24", true);
  expect(b.ipv4Configuration?.dhcpConfiguration?.ipAddressRange).toEqual({ start: "192.168.20.6", stop: "192.168.20.254" });
  expect(b.isolationEnabled).toBe(true);
  expect(b.mdnsForwardingEnabled).toBe(false);
  expect(b.internetAccessEnabled).toBe(true);
});

test("networksCommand shows VLAN, subnet and isolation", async () => {
  const out = await networksCommand(gateway().client, "site", false);
  expect(out).toMatch(/Default\s+1\s+192\.168\.0\.1\/24\s+no\s+yes\s+yes\s+net-default/);
});

test("networkCreateCommand creates and verifies an isolated network", async () => {
  const g = gateway();
  const out = await networkCreateCommand(g.client, "site", "IoT", { vlan: "20", subnet: "192.168.20.1/24", isolate: true, yes: false, confirm: yes });
  expect(out).toMatch(/created network "IoT": VLAN 20, 192\.168\.20\.1\/24, isolated yes/);
  expect(g.posts).toHaveLength(1);
});

test("networkCreateCommand refuses duplicates and overlaps without posting", async () => {
  const g = gateway([DEFAULT, { ...DEFAULT, id: "net-cam", name: "Cameras", vlanId: 30, default: false, ipv4Configuration: { hostIpAddress: "192.168.30.1", prefixLength: 24 } }]);
  const base = { isolate: true, yes: true, confirm: yes };
  await expect(networkCreateCommand(g.client, "s", "default", { ...base, vlan: "20", subnet: "192.168.20.1/24" })).rejects.toThrow(/already exists/);
  await expect(networkCreateCommand(g.client, "s", "IoT", { ...base, vlan: "30", subnet: "192.168.20.1/24" })).rejects.toThrow(/VLAN 30 is already used/);
  await expect(networkCreateCommand(g.client, "s", "IoT", { ...base, vlan: "20", subnet: "192.168.0.129/25" })).rejects.toThrow(/overlaps "Default"/);
  await expect(networkCreateCommand(g.client, "s", "IoT", { ...base, vlan: "9999", subnet: "192.168.20.1/24" })).rejects.toThrow(/--vlan/);
  expect(g.posts).toHaveLength(0);
});

test("networkCreateCommand aborts when not confirmed", async () => {
  const g = gateway();
  const out = await networkCreateCommand(g.client, "s", "IoT", { vlan: "20", subnet: "192.168.20.1/24", isolate: true, yes: false, confirm: async () => false });
  expect(out).toBe("aborted");
  expect(g.posts).toHaveLength(0);
});

test("networkCreateCommand errors if the gateway didn't store isolation", async () => {
  const g = gateway();
  const real = g.client as unknown as Record<string, (...a: any[]) => Promise<any>>;
  const client = stub({
    ...real,
    getNetwork: async (s: string, id: string) => ({ ...(await real.getNetwork(s, id)), ...(id === "net-default" ? {} : { isolationEnabled: false }) }),
  });
  await expect(networkCreateCommand(client, "s", "IoT", { vlan: "20", subnet: "192.168.20.1/24", isolate: true, yes: true, confirm: yes })).rejects.toThrow(/isolation is off/);
});

test("wifisCommand names the network", async () => {
  const out = await wifisCommand(gateway().client, "s", false);
  expect(out).toMatch(/wifi one\s+yes\s+Default\s+WPA2_PERSONAL\s+5,2\.4\s+w1/);
});

test("wifiCreateCommand puts a 2.4 GHz SSID on a specific network and prints a generated passphrase", async () => {
  const g = gateway([DEFAULT, { ...DEFAULT, id: "net-iot", name: "IoT", vlanId: 20, default: false }]);
  const out = await wifiCreateCommand(g.client, "s", "home-iot", { network: "iot", band: undefined, passphrase: undefined, yes: true, confirm: yes });
  const body = g.posts[0] as Record<string, any>;
  expect(body.network).toEqual({ type: "SPECIFIC", networkId: "net-iot" });
  expect(body.broadcastingFrequenciesGHz).toEqual([2.4]);
  expect("bandSteeringEnabled" in body).toBe(false);
  expect(body.securityConfiguration.type).toBe("WPA2_PERSONAL");
  expect(out).toContain(`passphrase: ${body.securityConfiguration.passphrase}`);
});

test("wifiCreateCommand doesn't echo a passphrase it was given, and checks inputs", async () => {
  const g = gateway();
  const out = await wifiCreateCommand(g.client, "s", "x2", { network: "Default", band: "both", passphrase: "correct horse", yes: true, confirm: yes });
  expect(out).not.toContain("correct horse");
  expect((g.posts[0] as any).network).toEqual({ type: "NATIVE" });
  const base = { network: "Default", band: undefined, yes: true, confirm: yes };
  await expect(wifiCreateCommand(g.client, "s", "wifi one", { ...base, passphrase: "longenough" })).rejects.toThrow(/already exists/);
  await expect(wifiCreateCommand(g.client, "s", "y", { ...base, passphrase: "short" })).rejects.toThrow(/8-63/);
  await expect(wifiCreateCommand(g.client, "s", "y", { ...base, band: "7", passphrase: "longenough" })).rejects.toThrow(/--band/);
  await expect(wifiCreateCommand(g.client, "s", "y", { ...base, network: "nope", passphrase: "longenough" })).rejects.toThrow(/no network matching/);
});

test("generatePassphrase avoids look-alike characters", () => {
  const p = generatePassphrase();
  expect(p).toHaveLength(20);
  expect(p).not.toMatch(/[0O1lI]/);
});

test("wifiPassphraseCommand PUTs the SSID back with only the passphrase changed", async () => {
  const full = { ...WIFI, metadata: { origin: "USER_DEFINED" }, securityConfiguration: { type: "WPA2_PERSONAL", fastRoamingEnabled: false }, hideName: false };
  const puts: [string, Record<string, any>][] = [];
  const client = stub({
    listWifiBroadcasts: async () => [WIFI],
    getWifiBroadcast: async () => ({ ...full }),
    updateWifiBroadcast: async (_s: string, id: string, body: Record<string, any>) => (puts.push([id, body]), body),
  });
  const out = await wifiPassphraseCommand(client, "s", "wifi one", { passphrase: "purple taco river", yes: true, confirm: yes });
  expect(out).toBe(`changed the passphrase of "wifi one"`);
  const [id, body] = puts[0];
  expect(id).toBe("w1");
  expect(body.id).toBeUndefined();
  expect(body.metadata).toBeUndefined();
  expect(body.securityConfiguration).toEqual({ type: "WPA2_PERSONAL", fastRoamingEnabled: false, passphrase: "purple taco river" });
  expect(body.hideName).toBe(false);
  await expect(wifiPassphraseCommand(client, "s", "nope", { passphrase: "longenough", yes: true, confirm: yes })).rejects.toThrow(/no SSID/);
  expect(await wifiPassphraseCommand(client, "s", "w1", { passphrase: "longenough", yes: false, confirm: async () => false })).toBe("aborted");
});
