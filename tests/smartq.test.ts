import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import type { LegacyNetwork } from "../src/types";
import { parseMbps, resolveWan, smartqCommand, smartqSetCommand } from "../src/commands/smartq";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;
const LAN: LegacyNetwork = { _id: "lan", name: "Default", purpose: "corporate" };
const WAN1: LegacyNetwork = { _id: "w1", name: "Internet 1", purpose: "wan", wan_networkgroup: "WAN", wan_smartq_enabled: false, wan_type: "dhcp" };
const WAN2: LegacyNetwork = { _id: "w2", name: "Internet 2", purpose: "wan", wan_networkgroup: "WAN2", wan_smartq_enabled: false };
const NETS = [LAN, WAN2, WAN1];

test("resolveWan defaults to the primary WAN and matches name or group", () => {
  expect(resolveWan(NETS, undefined)._id).toBe("w1");
  expect(resolveWan(NETS, "wan2")._id).toBe("w2");
  expect(resolveWan(NETS, "internet 2")._id).toBe("w2");
  expect(() => resolveWan(NETS, "default")).toThrow(/no WAN matching/);
});

test("parseMbps converts to kbps and rejects junk", () => {
  expect(parseMbps("36", "upload")).toBe(36000);
  expect(parseMbps("36.5", "upload")).toBe(36500);
  expect(() => parseMbps("0", "upload")).toThrow(/invalid upload/);
  expect(() => parseMbps("fast", "download")).toThrow(/invalid download/);
});

test("smartqCommand lists WANs only", async () => {
  const on = { ...WAN1, wan_smartq_enabled: true, wan_smartq_down_rate: 210000, wan_smartq_up_rate: 36000 };
  const out = await smartqCommand(stub({ listNetworks: async () => [LAN, on, WAN2] }), "default", false);
  expect(out).toMatch(/Internet 1\s+WAN\s+on\s+210 Mbps\s+36 Mbps/);
  expect(out).toMatch(/Internet 2\s+WAN2\s+off/);
  expect(out).not.toMatch(/Default/);
});

test("smartqSetCommand sends the whole WAN object with smartq fields set", async () => {
  let sent: LegacyNetwork | undefined;
  let asked = "";
  const client = stub({ listNetworks: async () => NETS, updateNetwork: async (_s: string, n: LegacyNetwork) => ((sent = n), [n]) });
  const out = await smartqSetCommand(client, "default", { down: "210", up: "36" }, {
    yes: false,
    confirm: async (m: string) => ((asked = m), true),
  });
  expect(asked).toMatch(/off → on \(down 210 Mbps, up 36 Mbps\)/);
  expect(sent).toEqual({ ...WAN1, wan_smartq_enabled: true, wan_smartq_down_rate: 210000, wan_smartq_up_rate: 36000 });
  expect(out).toMatch(/applied/);
});

test("smartqSetCommand off, no-op and abort", async () => {
  const on = { ...WAN1, wan_smartq_enabled: true, wan_smartq_down_rate: 210000, wan_smartq_up_rate: 36000 };
  let sent: LegacyNetwork | undefined;
  const client = stub({ listNetworks: async () => [on], updateNetwork: async (_s: string, n: LegacyNetwork) => ((sent = n), [n]) });
  expect(await smartqSetCommand(client, "default", { down: "210", up: "36" }, { yes: true, confirm: async () => true })).toMatch(/already on/);
  expect(sent).toBeUndefined();
  expect(await smartqSetCommand(client, "default", null, { yes: false, confirm: async () => false })).toBe("aborted");
  expect(sent).toBeUndefined();
  await smartqSetCommand(client, "default", null, { yes: true, confirm: async () => false });
  expect(sent?.wan_smartq_enabled).toBe(false);
});
