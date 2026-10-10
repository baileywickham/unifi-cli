import type { ApiClient } from "../api";
import { json } from "../format";

/** UPnP / NAT-PMP state on the gateway (read-only). */
export async function upnpCommand(client: ApiClient, siteRef: string, asJson: boolean): Promise<string> {
  const s = await client.getUsgSetting(siteRef);
  const row = {
    upnpEnabled: s.upnp_enabled === true,
    natPmpEnabled: s.upnp_nat_pmp_enabled === true,
    secureMode: s.upnp_secure_mode === true,
  };
  if (asJson) return json(row);
  const onOff = (v: boolean) => (v ? "on" : "off");
  return [
    ["upnp", onOff(row.upnpEnabled)],
    ["nat-pmp", onOff(row.natPmpEnabled)],
    ["secure mode", onOff(row.secureMode)],
  ]
    .map(([k, v]) => `${k.padEnd(12)}${v}`)
    .join("\n");
}
