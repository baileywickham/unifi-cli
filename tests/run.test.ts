import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import { run, USAGE } from "../src/main";

const SITES = [
  { id: "s1", name: "default" },
  { id: "s2", name: "cabin" },
];
const DEVICES = [
  { id: "d1", name: "gateway", model: "UCG-Ultra", macAddress: "aa", ipAddress: "192.168.0.1", state: "ONLINE" },
];

const stub = (methods: Record<string, unknown> = {}) =>
  ({ listSites: async () => SITES, listDevices: async () => DEVICES, ...methods }) as unknown as ApiClient;

const never: (msg: string) => Promise<boolean> = async () => {
  throw new Error("confirm should not be called");
};

test("help returns usage", async () => {
  expect(await run(["--help"], stub(), undefined, never)).toBe(USAGE);
});

test("devices uses first site by default", async () => {
  const seen: string[] = [];
  const client = stub({ listDevices: async (siteId: string) => (seen.push(siteId), DEVICES) });
  await run(["devices"], client, undefined, never);
  expect(seen).toEqual(["s1"]);
});

test("--site resolves by name, defaultSite from config is used", async () => {
  const seen: string[] = [];
  const client = stub({ listDevices: async (siteId: string) => (seen.push(siteId), DEVICES) });
  await run(["devices", "--site", "cabin"], client, undefined, never);
  await run(["devices"], client, "cabin", never);
  expect(seen).toEqual(["s2", "s2"]);
});

test("unknown site lists available sites", async () => {
  await expect(run(["devices", "--site", "nope"], stub(), undefined, never)).rejects.toThrow(/default, cabin/);
});

test("unknown command throws with usage", async () => {
  await expect(run(["frobnicate"], stub(), undefined, never)).rejects.toThrow(/unknown command/);
});

test("device restart routes through confirm", async () => {
  let asked = "";
  let restarted = false;
  const client = stub({ restartDevice: async () => void (restarted = true) });
  const out = await run(["device", "restart", "gateway"], client, undefined, async (msg) => ((asked = msg), true));
  expect(asked).toContain("Restart gateway");
  expect(restarted).toBe(true);
  expect(out).toContain("restart requested");
});

test("device <name> shows detail", async () => {
  const client = stub({
    getDevice: async () => DEVICES[0],
    getDeviceStats: async () => ({}),
  });
  expect(await run(["device", "gateway"], client, undefined, never)).toContain("UCG-Ultra");
});

test("power-cycle requires numeric port", async () => {
  await expect(run(["device", "power-cycle", "gateway", "abc"], stub(), undefined, never)).rejects.toThrow(/port/);
});

test("radio set routes flags through confirm on the site's internalReference", async () => {
  const seen: unknown[] = [];
  const ap = { _id: "ap1", mac: "aa", name: "U7 Lite", radio_table: [{ name: "wifi1", radio: "na", channel: "auto", ht: "40" }] };
  const client = stub({
    listSites: async () => [{ id: "s1", name: "Default", internalReference: "default" }],
    listLegacyDevices: async (ref: string) => (seen.push(ref), [ap]),
    updateRadioTable: async (ref: string, id: string, rt: unknown) => void seen.push([ref, id, rt]),
  });
  let asked = "";
  const out = await run(
    ["radio", "set", "U7 Lite", "5", "--width", "80", "--channel", "auto", "--tx-power", "high"],
    client,
    undefined,
    async (msg) => ((asked = msg), true),
  );
  expect(asked).toContain("40 MHz → 80 MHz");
  expect(asked).toContain("tx power  auto → high");
  expect(out).toContain("applied");
  expect(seen[1]).toEqual(["default", "ap1", [{ name: "wifi1", radio: "na", channel: "auto", ht: "80", tx_power_mode: "high" }]]);
});

test("radio requires set <device> <band>", async () => {
  await expect(run(["radio", "U7 Lite"], stub(), undefined, never)).rejects.toThrow(/usage: unifi radio set/);
});
