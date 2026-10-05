import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { LegacyNeighbor } from "../src/types";
import { channelRows, neighborsCommand } from "../src/commands/neighbors";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;
const n = (band: string, channel: number, signal?: number): LegacyNeighbor => ({ bssid: `${band}${channel}${signal}`, band, channel, signal });
const HEARD = [n("na", 149, -77), n("na", 149, -89), n("na", 149, -70), n("ng", 11, -64), n("na", 36)];

test("channelRows groups by band and channel with strongest and loud counts", () => {
  expect(channelRows(HEARD)).toEqual([
    { band: "2.4 GHz", channel: 11, networks: 1, strongest: -64, strongNetworks: 1 },
    { band: "5 GHz", channel: 36, networks: 1, strongest: null, strongNetworks: 0 },
    { band: "5 GHz", channel: 149, networks: 3, strongest: -70, strongNetworks: 1 },
  ]);
});

test("neighborsCommand filters by band and passes the lookback", async () => {
  let hours = 0;
  const client = stub({ listNeighbors: async (_s: string, h: number) => ((hours = h), HEARD) });
  const out = await neighborsCommand(client, "default", { band: "5", hours: 24, json: false });
  expect(hours).toBe(24);
  expect(out).toMatch(/5 GHz\s+149\s+3\s+-70 dBm\s+1/);
  expect(out).not.toMatch(/2\.4 GHz/);
  expect(out).toMatch(/weren't scanned/);
});

test("neighborsCommand reports an empty scan", async () => {
  const out = await neighborsCommand(stub({ listNeighbors: async () => [] }), "default", { json: false });
  expect(out).toBe("no neighboring networks heard");
});
