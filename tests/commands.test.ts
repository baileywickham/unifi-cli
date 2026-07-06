import { test, expect } from "bun:test";
import type { ApiClient } from "../src/api";
import { infoCommand } from "../src/commands/info";
import { sitesCommand } from "../src/commands/sites";
import { devicesCommand } from "../src/commands/devices";
import { clientsCommand } from "../src/commands/clients";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;

const DEVICES = [
  { id: "d1", name: "gateway", model: "UCG-Ultra", macAddress: "aa", ipAddress: "192.168.0.1", state: "ONLINE", firmwareVersion: "4.1.13" },
  { id: "d2", name: "living-room", model: "U6+", macAddress: "bb", ipAddress: "192.168.0.5", state: "ONLINE" },
];

test("infoCommand plain and json", async () => {
  const client = stub({ getInfo: async () => ({ applicationVersion: "9.1.0" }) });
  expect(await infoCommand(client, false)).toBe("applicationVersion  9.1.0");
  expect(JSON.parse(await infoCommand(client, true))).toEqual({ applicationVersion: "9.1.0" });
});

test("sitesCommand renders table", async () => {
  const client = stub({ listSites: async () => [{ id: "s1", name: "default" }] });
  const out = await sitesCommand(client, false);
  expect(out).toContain("ID");
  expect(out).toContain("default");
});

test("devicesCommand renders table with model column", async () => {
  const client = stub({ listDevices: async () => DEVICES });
  const out = await devicesCommand(client, "s1", false);
  expect(out).toContain("UCG-Ultra");
  expect(out).toContain("living-room");
  expect(out.split("\n")[0]).toBe("NAME         MODEL      IP           STATE   FIRMWARE");
});

test("devicesCommand --json returns raw list", async () => {
  const client = stub({ listDevices: async () => DEVICES });
  expect(JSON.parse(await devicesCommand(client, "s1", true))).toHaveLength(2);
});

test("clientsCommand filters wired/wireless", async () => {
  const clients = [
    { id: "c1", name: "mac", type: "WIRED", ipAddress: "192.168.0.37" },
    { id: "c2", name: "iphone", type: "WIRELESS", ipAddress: "192.168.0.38" },
  ];
  const client = stub({ listClients: async () => clients });
  const wired = await clientsCommand(client, "s1", { wired: true, wireless: false, json: false });
  expect(wired).toContain("mac");
  expect(wired).not.toContain("iphone");
  const wireless = await clientsCommand(client, "s1", { wired: false, wireless: true, json: false });
  expect(wireless).toContain("iphone");
  expect(wireless).not.toContain("mac");
});

test("clientsCommand rejects both wired and wireless", async () => {
  const client = stub({ listClients: async () => [] });
  await expect(
    clientsCommand(client, "s1", { wired: true, wireless: true, json: false }),
  ).rejects.toThrow(/mutually exclusive/);
});
