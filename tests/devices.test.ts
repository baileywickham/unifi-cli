import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { Device } from "../src/types";
import { resolveDevice, deviceDetailCommand, restartCommand, powerCycleCommand } from "../src/commands/devices";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;

const DEVICES: Device[] = [
  { id: "d1", name: "gateway", model: "UCG-Ultra", macAddress: "aa", ipAddress: "192.168.0.1", state: "ONLINE" },
  { id: "d2", name: "Living-Room", model: "U6+", macAddress: "bb", ipAddress: "192.168.0.5", state: "ONLINE" },
  { id: "d3", name: "spare", model: "U6+", macAddress: "cc", ipAddress: "192.168.0.6", state: "OFFLINE" },
];

test("resolveDevice matches id, then case-insensitive name", () => {
  expect(resolveDevice(DEVICES, "d2").name).toBe("Living-Room");
  expect(resolveDevice(DEVICES, "living-room").id).toBe("d2");
});

test("resolveDevice errors on no match and ambiguity", () => {
  expect(() => resolveDevice(DEVICES, "nope")).toThrow(/no device matching/);
  const dupes = [...DEVICES, { ...DEVICES[2], id: "d4" }];
  expect(() => resolveDevice(dupes, "spare")).toThrow(/ambiguous/);
});

test("deviceDetailCommand shows stats and survives stats 404", async () => {
  const client = stub({
    listDevices: async () => DEVICES,
    getDevice: async () => DEVICES[0],
    getDeviceStats: async () => ({ uptimeSec: 90061, cpuUtilizationPct: 12 }),
  });
  const out = await deviceDetailCommand(client, "s1", "gateway", false);
  expect(out).toContain("UCG-Ultra");
  expect(out).toContain("1d 1h");
  const noStats = stub({
    listDevices: async () => DEVICES,
    getDevice: async () => DEVICES[0],
    getDeviceStats: async () => {
      throw new Error("404");
    },
  });
  expect(await deviceDetailCommand(noStats, "s1", "gateway", false)).toContain("UCG-Ultra");
});

test("restartCommand aborts when confirm declines, runs with --yes", async () => {
  let restarted = 0;
  const client = stub({ listDevices: async () => DEVICES, restartDevice: async () => void restarted++ });
  const declined = await restartCommand(client, "s1", "gateway", { yes: false, confirm: async () => false });
  expect(declined).toBe("aborted");
  expect(restarted).toBe(0);
  const ran = await restartCommand(client, "s1", "gateway", { yes: true, confirm: async () => false });
  expect(ran).toContain("restart requested");
  expect(restarted).toBe(1);
});

test("powerCycleCommand passes port index", async () => {
  const calls: number[] = [];
  const client = stub({ listDevices: async () => DEVICES, powerCyclePort: async (_s: string, _d: string, p: number) => void calls.push(p) });
  await powerCycleCommand(client, "s1", "gateway", 3, { yes: true, confirm: async () => true });
  expect(calls).toEqual([3]);
});

test("powerCycleCommand aborts when confirm declines without calling API", async () => {
  let cycled = 0;
  const client = stub({ listDevices: async () => DEVICES, powerCyclePort: async () => void cycled++ });
  const declined = await powerCycleCommand(client, "s1", "gateway", 3, { yes: false, confirm: async () => false });
  expect(declined).toBe("aborted");
  expect(cycled).toBe(0);
});
