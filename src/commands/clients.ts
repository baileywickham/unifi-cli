import type { ApiClient } from "../api";
import { json, table } from "../format";

export async function clientsCommand(
  client: ApiClient,
  siteId: string,
  opts: { wired: boolean; wireless: boolean; json: boolean },
): Promise<string> {
  if (opts.wired && opts.wireless) throw new Error("--wired and --wireless are mutually exclusive");
  let clients = await client.listClients(siteId);
  if (opts.wired) clients = clients.filter((c) => c.type === "WIRED");
  if (opts.wireless) clients = clients.filter((c) => c.type === "WIRELESS");
  if (opts.json) return json(clients);
  return table(
    ["NAME", "IP", "MAC", "TYPE", "CONNECTED"],
    clients.map((c) => [c.name ?? "", c.ipAddress ?? "", c.macAddress ?? "", c.type, c.connectedAt ?? ""]),
  );
}
