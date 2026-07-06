import type { ApiClient } from "../api";
import { json, table } from "../format";

export async function sitesCommand(client: ApiClient, asJson: boolean): Promise<string> {
  const sites = await client.listSites();
  if (asJson) return json(sites);
  return table(["ID", "NAME"], sites.map((s) => [s.id, s.name]));
}
