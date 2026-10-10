import type { ApiClient } from "../api";
import type { LegacyPortForward } from "../types";
import { json, table } from "../format";
import type { Confirm } from "./devices";

/** Who may use the rule: "any", or the allowed source IP/CIDR or firewall group. */
export function portForwardSource(r: LegacyPortForward): string {
  if (!r.src_limiting_enabled) return "any";
  if (r.src) return r.src;
  if (r.src_firewall_group_id) return `group ${r.src_firewall_group_id}`;
  return "limited";
}

const target = (r: LegacyPortForward) => `${r.fwd ?? "?"}:${r.fwd_port ?? r.dst_port ?? "?"}`;
const describe = (r: LegacyPortForward) =>
  `"${r.name}" (${r.proto ?? "?"} ${r.dst_port ?? "?"} → ${target(r)}, from ${portForwardSource(r)})`;

export async function portForwardsCommand(client: ApiClient, siteRef: string, asJson: boolean): Promise<string> {
  const rules = await client.listPortForwards(siteRef);
  if (asJson) return json(rules);
  if (rules.length === 0) return "no port forwards";
  return table(
    ["NAME", "ENABLED", "PROTO", "PORT", "FORWARD TO", "SOURCE", "ID"],
    rules.map((r) => [
      r.name,
      r.enabled ? "yes" : "no",
      r.proto ?? "",
      r.dst_port ?? "",
      target(r),
      portForwardSource(r),
      r._id,
    ]),
  );
}

/** Match a rule by id or name (case-insensitive). */
export function resolvePortForward(rules: LegacyPortForward[], ref: string): LegacyPortForward {
  const byId = rules.find((r) => r._id === ref);
  if (byId) return byId;
  const matches = rules.filter((r) => r.name?.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`no port forward matching "${ref}" (have: ${rules.map((r) => r.name).join(", ") || "none"})`);
  }
  throw new Error(`ambiguous port forward "${ref}": ids ${matches.map((m) => m._id).join(", ")}`);
}

/**
 * Enable or disable a port-forward rule. The PUT carries the whole rule with
 * only `enabled` changed; the rule is then re-read to report its actual state.
 */
export async function portForwardToggleCommand(
  client: ApiClient,
  siteRef: string,
  ref: string,
  enabled: boolean,
  opts: { yes: boolean; confirm: Confirm },
): Promise<string> {
  const rule = resolvePortForward(await client.listPortForwards(siteRef), ref);
  const state = (on: boolean) => (on ? "enabled" : "disabled");
  if (rule.enabled === enabled) return `port forward ${describe(rule)} is already ${state(enabled)}`;
  const prompt = enabled
    ? `Enable port forward ${describe(rule)}? This exposes ${target(rule)} to the internet.`
    : `Disable port forward ${describe(rule)}?`;
  if (!opts.yes && !(await opts.confirm(prompt))) return "aborted";
  await client.updatePortForward(siteRef, { ...rule, enabled });
  const after = (await client.listPortForwards(siteRef)).find((r) => r._id === rule._id);
  if (!after) throw new Error(`port forward ${rule._id} disappeared after the update`);
  if (after.enabled !== enabled) {
    throw new Error(`gateway accepted the update but port forward "${after.name}" is still ${state(after.enabled)}`);
  }
  return `port forward ${describe(after)} is now ${state(after.enabled)}`;
}
