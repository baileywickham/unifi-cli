import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { LegacyDevice, LegacyRadio } from "../src/types";
import { parseBand, radioPatch, radioDiff, radiosCommand, radioSetCommand, resolveLegacyDevice } from "../src/commands/radios";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;

const AP: LegacyDevice = {
  _id: "ap1",
  mac: "a8:9c:6c:c8:28:02",
  name: "U7 Lite",
  type: "uap",
  radio_table: [
    { name: "wifi0", radio: "ng", channel: "auto", ht: "20", min_txpower: 6 },
    { name: "wifi1", radio: "na", channel: "auto", ht: "40", has_ht160: true },
  ],
  radio_table_stats: [
    { name: "wifi0", radio: "ng", channel: 11, bw: 20, tx_power: 23, num_sta: 2 },
    { name: "wifi1", radio: "na", channel: 149, bw: 40, tx_power: 24, num_sta: 6 },
  ],
};
const GATEWAY: LegacyDevice = { _id: "gw", mac: "58:d6:1f:2b:15:91", name: "Cloud Gateway Ultra", type: "udm" };
const DEVICES = [GATEWAY, AP];

test("parseBand accepts common spellings", () => {
  expect(parseBand("2.4")).toBe("2.4");
  expect(parseBand("2.4GHz")).toBe("2.4");
  expect(parseBand("5g")).toBe("5");
  expect(parseBand("6e")).toBe("6");
  expect(() => parseBand("60")).toThrow(/unknown band/);
});

test("resolveLegacyDevice matches id, name and mac", () => {
  expect(resolveLegacyDevice(DEVICES, "ap1").name).toBe("U7 Lite");
  expect(resolveLegacyDevice(DEVICES, "u7 lite")._id).toBe("ap1");
  expect(resolveLegacyDevice(DEVICES, "A8:9C:6C:C8:28:02")._id).toBe("ap1");
  expect(() => resolveLegacyDevice(DEVICES, "nope")).toThrow(/no device matching/);
});

test("radioPatch validates width per band", () => {
  expect(radioPatch("2.4", { width: "40" })).toEqual({ ht: "40" });
  expect(() => radioPatch("2.4", { width: "80" })).toThrow(/allowed: 20, 40/);
  expect(radioPatch("5", { width: "160" })).toEqual({ ht: "160" });
  expect(() => radioPatch("5", { width: "320" })).toThrow(/invalid width/);
  expect(radioPatch("6", { width: "320" })).toEqual({ ht: "320" });
  expect(() => radioPatch("5", { width: "wide" })).toThrow(/invalid width/);
});

test("radioPatch validates channel and tx power", () => {
  expect(radioPatch("5", { channel: "149" })).toEqual({ channel: 149 });
  expect(radioPatch("5", { channel: "AUTO" })).toEqual({ channel: "auto" });
  expect(() => radioPatch("2.4", { channel: "36" })).toThrow(/invalid channel/);
  expect(radioPatch("5", { txPower: "High" })).toEqual({ tx_power_mode: "high" });
  expect(() => radioPatch("5", { txPower: "max" })).toThrow(/--tx-power/);
  expect(() => radioPatch("5", {})).toThrow(/nothing to change/);
});

test("radioDiff lists only fields that change", () => {
  const before: LegacyRadio = { name: "wifi1", radio: "na", channel: "auto", ht: "40" };
  expect(radioDiff(before, { ht: "80", channel: "auto" })).toEqual(["width     40 MHz → 80 MHz"]);
  expect(radioDiff(before, { tx_power_mode: "auto" })).toEqual([]);
  expect(radioDiff(before, { tx_power_mode: "low" })).toEqual(["tx power  auto → low"]);
});

test("radiosCommand shows configured vs current per AP radio, skipping non-APs", async () => {
  const client = stub({ listLegacyDevices: async () => DEVICES });
  const out = await radiosCommand(client, "default", undefined, false);
  expect(out).not.toContain("Cloud Gateway");
  const lines = out.split("\n");
  expect(lines[0]).toMatch(/^DEVICE\s+BAND\s+RADIO\s+CHANNEL\s+CH NOW\s+WIDTH\s+WIDTH NOW\s+TX POWER\s+CLIENTS\s+BUSY\s+RETRIES$/);
  expect(lines[2]).toMatch(/U7 Lite\s+5 GHz\s+wifi1\s+auto\s+149\s+40 MHz\s+40 MHz\s+auto\s+6/);
  const j = JSON.parse(await radiosCommand(client, "default", "U7 Lite", true));
  expect(j[1]).toMatchObject({ band: "5 GHz", configured: { channel: "auto", widthMHz: 40 }, current: { channel: 149 } });
  await expect(radiosCommand(client, "default", "Cloud Gateway Ultra", false)).rejects.toThrow(/no device/);
});

test("radioSetCommand shows a diff, aborts on decline, PUTs the full table with --yes", async () => {
  const puts: [string, LegacyRadio[]][] = [];
  const client = stub({
    listLegacyDevices: async () => DEVICES,
    updateRadioTable: async (_s: string, id: string, rt: LegacyRadio[]) => void puts.push([id, rt]),
  });
  let asked = "";
  const declined = await radioSetCommand(client, "default", "U7 Lite", "5", { width: "80" }, {
    yes: false,
    confirm: async (m) => ((asked = m), false),
  });
  expect(declined).toBe("aborted");
  expect(asked).toContain("width     40 MHz → 80 MHz");
  expect(asked).toContain("drops clients");
  expect(puts).toHaveLength(0);

  const out = await radioSetCommand(client, "default", "u7 lite", "5", { width: "80", channel: "149" }, {
    yes: true,
    confirm: async () => {
      throw new Error("confirm should not be called");
    },
  });
  expect(out).toContain("applied");
  expect(puts).toHaveLength(1);
  const [id, rt] = puts[0];
  expect(id).toBe("ap1");
  expect(rt).toEqual([
    AP.radio_table![0],
    { name: "wifi1", radio: "na", channel: 149, ht: "80", has_ht160: true },
  ]);
  // the fixture itself was not mutated
  expect(AP.radio_table![1].ht).toBe("40");
});

test("radioSetCommand is a no-op when nothing changes, errors on a missing band", async () => {
  const client = stub({
    listLegacyDevices: async () => DEVICES,
    updateRadioTable: async () => {
      throw new Error("should not write");
    },
  });
  const opts = { yes: true, confirm: async () => true };
  expect(await radioSetCommand(client, "default", "U7 Lite", "5", { width: "40" }, opts)).toContain("nothing to change");
  await expect(radioSetCommand(client, "default", "U7 Lite", "6", { width: "80" }, opts)).rejects.toThrow(/no 6 GHz radio/);
  await expect(radioSetCommand(client, "default", "U7 Lite", "2.4", { width: "80" }, opts)).rejects.toThrow(/invalid width/);
});
