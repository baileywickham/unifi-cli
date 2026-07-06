import type { ApiClient } from "../api";
import { json } from "../format";

export async function infoCommand(client: ApiClient, asJson: boolean): Promise<string> {
  const info = await client.getInfo();
  return asJson ? json(info) : `applicationVersion  ${info.applicationVersion}`;
}
