import { test, expect } from "bun:test";
import { ApiClient } from "../src/api";
import type { LegacyPortForward } from "../src/types";
import {
  portForwardSource,
  portForwardsCommand,
  portForwardToggleCommand,
  resolvePortForward,
} from "../src/commands/portforwards";
import { upnpCommand } from "../src/commands/upnp";
import { run } from "../src/main";

const stub = (methods: Record<string, unknown>) => methods as unknown as ApiClient;

// Shape observed on Network 10.6 (GET /rest/portforward).
const UBNT: LegacyPortForward = {
  _id: "pf1",
  name: "ubnt",
  enabled: false,
  proto: "tcp_udp",
  dst_port: "443",
  fwd: "192.168.0.41",
  fwd_port: "443",
  src_limiting_enabled: false,
  pfwd_interface: "all",
  log: false,
  site_id: "site",
  destination_ips: [{ destination_ip: "any", interface: "wan" }],
};
const SSH: LegacyPortForward = { ...UBNT, _id: "pf2", name: "ssh", enabled: true, dst_port: "2222", fwd_port: "22", src_limiting_enabled: true, src: "203.0.113.0/24" };

/** A fake gateway that stores rules and applies PUTs, like the real one. */
function gateway(rules: LegacyPortForward[], applyPut = true) {
  let state = rules.map((r) => ({ ...r }));
  const puts: LegacyPortForward[] = [];
  const client = stub({
    listPortForwards: async () => state.map((r) => ({ ...r })),
    updatePortForward: async (_s: string, rule: LegacyPortForward) => {
      puts.push(rule);
      if (applyPut) state = state.map((r) => (r._id === rule._id ? { ...rule } : r));
      return [rule];
    },
  });
  return { client, puts };
}

test("portForwardSource shows any, CIDR or group", () => {
  expect(portForwardSource(UBNT)).toBe("any");
  expect(portForwardSource(SSH)).toBe("203.0.113.0/24");
  expect(portForwardSource({ ...UBNT, src_limiting_enabled: true, src_firewall_group_id: "g1" })).toBe("group g1");
});

test("portForwardsCommand renders a table and raw json", async () => {
  const { client } = gateway([UBNT, SSH]);
  const out = await portForwardsCommand(client, "default", false);
  expect(out.split("\n")[0]).toMatch(/^NAME\s+ENABLED\s+PROTO\s+PORT\s+FORWARD TO\s+SOURCE\s+ID$/);
  expect(out).toMatch(/ubnt\s+no\s+tcp_udp\s+443\s+192\.168\.0\.41:443\s+any\s+pf1/);
  expect(out).toMatch(/ssh\s+yes\s+tcp_udp\s+2222\s+192\.168\.0\.41:22\s+203\.0\.113\.0\/24\s+pf2/);
  expect(JSON.parse(await portForwardsCommand(client, "default", true))).toHaveLength(2);
  expect(await portForwardsCommand(gateway([]).client, "default", false)).toBe("no port forwards");
});

test("resolvePortForward matches id or name", () => {
  expect(resolvePortForward([UBNT, SSH], "pf2").name).toBe("ssh");
  expect(resolvePortForward([UBNT, SSH], "UBNT")._id).toBe("pf1");
  expect(() => resolvePortForward([UBNT, SSH], "nope")).toThrow(/no port forward matching "nope" \(have: ubnt, ssh\)/);
  expect(() => resolvePortForward([UBNT, { ...UBNT, _id: "pf3" }], "ubnt")).toThrow(/ambiguous/);
});

test("enable PUTs the whole rule with enabled toggled, then re-reads", async () => {
  const { client, puts } = gateway([UBNT, SSH]);
  let asked = "";
  const out = await portForwardToggleCommand(client, "default", "ubnt", true, {
    yes: false,
    confirm: async (m) => ((asked = m), true),
  });
  expect(asked).toMatch(/Enable port forward "ubnt" \(tcp_udp 443 → 192\.168\.0\.41:443, from any\)\? This exposes/);
  expect(puts).toEqual([{ ...UBNT, enabled: true }]);
  expect(out).toMatch(/"ubnt" .* is now enabled/);
});

test("disable, abort, already-in-state", async () => {
  const { client, puts } = gateway([UBNT, SSH]);
  expect(await portForwardToggleCommand(client, "default", "ubnt", false, { yes: false, confirm: async () => true })).toMatch(/already disabled/);
  expect(await portForwardToggleCommand(client, "default", "ssh", false, { yes: false, confirm: async () => false })).toBe("aborted");
  expect(puts).toHaveLength(0);
  const out = await portForwardToggleCommand(client, "default", "pf2", false, {
    yes: true,
    confirm: async () => {
      throw new Error("confirm should not be called with --yes");
    },
  });
  expect(puts).toEqual([{ ...SSH, enabled: false }]);
  expect(out).toMatch(/"ssh" .* is now disabled/);
});

test("toggle reports when the gateway did not apply the change", async () => {
  const { client } = gateway([UBNT], false);
  await expect(portForwardToggleCommand(client, "default", "ubnt", true, { yes: true, confirm: async () => true })).rejects.toThrow(
    /still disabled/,
  );
});

test("ApiClient port-forward and usg endpoints", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ meta: { rc: "ok" }, data: url.endsWith("/get/setting/usg") ? [{ key: "usg", upnp_enabled: false }] : [UBNT] });
  };
  const api = new ApiClient("https://gw", "KEY", fetchFn as any);
  await api.listPortForwards("default");
  await api.updatePortForward("default", { ...UBNT, enabled: true });
  expect((await api.getUsgSetting("default")).upnp_enabled).toBe(false);
  expect(calls[0].url).toBe("https://gw/proxy/network/api/s/default/rest/portforward");
  expect(calls[1].url).toBe("https://gw/proxy/network/api/s/default/rest/portforward/pf1");
  expect(calls[1].init.method).toBe("PUT");
  expect(JSON.parse(calls[1].init.body as string)).toEqual({ ...UBNT, enabled: true });
  expect(calls[2].url).toBe("https://gw/proxy/network/api/s/default/get/setting/usg");
});

test("upnpCommand plain and json", async () => {
  const client = stub({ getUsgSetting: async () => ({ key: "usg", upnp_enabled: false, upnp_nat_pmp_enabled: true }) });
  const out = await upnpCommand(client, "default", false);
  expect(out).toMatch(/^upnp\s+off$/m);
  expect(out).toMatch(/^nat-pmp\s+on$/m);
  expect(JSON.parse(await upnpCommand(client, "default", true))).toEqual({ upnpEnabled: false, natPmpEnabled: true, secureMode: false });
});

test("run routes portforward enable through confirm and rejects bad usage", async () => {
  const { client, puts } = gateway([UBNT]);
  const c = Object.assign(client, { listSites: async () => [{ id: "s1", name: "Default", internalReference: "default" }] });
  expect(await run(["portforward", "enable", "ubnt"], c, undefined, async () => false)).toBe("aborted");
  expect(puts).toHaveLength(0);
  await expect(run(["portforward", "delete", "ubnt"], c, undefined, async () => true)).rejects.toThrow(/usage: unifi portforward enable\|disable/);
  await expect(run(["portforward", "enable"], c, undefined, async () => true)).rejects.toThrow(/usage/);
});
