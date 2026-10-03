import type {
  AppInfo,
  Client,
  Device,
  DeviceDetail,
  DeviceStats,
  LegacyDevice,
  LegacyNetwork,
  LegacyRadio,
  LegacyUser,
  Page,
  Site,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const PAGE_LIMIT = 200;

export class ApiClient {
  constructor(
    private gateway: string,
    private apiKey: string,
    private fetchFn: FetchLike = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, base = "/proxy/network/integration"): Promise<T> {
    const url = `${this.gateway}${base}${path}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          "X-API-KEY": this.apiKey,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // Bun extension: accept the gateway's self-signed certificate
        tls: { rejectUnauthorized: false },
      } as RequestInit);
    } catch (err) {
      throw new ApiError(0, `cannot reach ${this.gateway} — are you on the LAN? (${(err as Error).message})`);
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const parsed = (await res.json()) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // non-JSON error body; keep statusText
      }
      if (res.status === 404) message += " (endpoint may not be supported by this gateway's firmware)";
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * The legacy Network API (what the web UI itself uses) accepts the same
   * X-API-KEY and covers things the Integrations API still lacks, such as
   * DHCP reservations. Responses are `{ meta: { rc }, data: [...] }`.
   * `siteRef` is the site's `internalReference` ("default"), not its UUID.
   */
  private async legacy<T>(method: string, siteRef: string, path: string, body?: unknown): Promise<T[]> {
    const res = await this.request<{ meta?: { rc?: string; msg?: string }; data?: T[] }>(
      method,
      `/s/${siteRef}${path}`,
      body,
      "/proxy/network/api",
    );
    if (res.meta?.rc && res.meta.rc !== "ok") throw new ApiError(0, res.meta.msg ?? `legacy API rc=${res.meta.rc}`);
    return res.data ?? [];
  }

  private async allPages<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let offset = 0;
    while (true) {
      const page = await this.request<Page<T>>("GET", `${path}?offset=${offset}&limit=${PAGE_LIMIT}`);
      items.push(...page.data);
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.totalCount) return items;
    }
  }

  getInfo(): Promise<AppInfo> {
    return this.request("GET", "/v1/info");
  }
  listSites(): Promise<Site[]> {
    return this.allPages("/v1/sites");
  }
  listDevices(siteId: string): Promise<Device[]> {
    return this.allPages(`/v1/sites/${siteId}/devices`);
  }
  getDevice(siteId: string, deviceId: string): Promise<DeviceDetail> {
    return this.request("GET", `/v1/sites/${siteId}/devices/${deviceId}`);
  }
  getDeviceStats(siteId: string, deviceId: string): Promise<DeviceStats> {
    return this.request("GET", `/v1/sites/${siteId}/devices/${deviceId}/statistics/latest`);
  }
  listClients(siteId: string): Promise<Client[]> {
    return this.allPages(`/v1/sites/${siteId}/clients`);
  }
  restartDevice(siteId: string, deviceId: string): Promise<void> {
    return this.request("POST", `/v1/sites/${siteId}/devices/${deviceId}/actions`, { action: "RESTART" });
  }
  powerCyclePort(siteId: string, deviceId: string, portIdx: number): Promise<void> {
    return this.request("POST", `/v1/sites/${siteId}/devices/${deviceId}/interfaces/ports/${portIdx}/actions`, {
      action: "POWER_CYCLE",
    });
  }

  /** Known clients (legacy API) — includes offline ones and DHCP reservations. */
  listUsers(siteRef: string): Promise<LegacyUser[]> {
    return this.legacy("GET", siteRef, "/rest/user");
  }
  listNetworks(siteRef: string): Promise<LegacyNetwork[]> {
    return this.legacy("GET", siteRef, "/rest/networkconf");
  }
  updateUser(siteRef: string, userId: string, patch: Partial<LegacyUser>): Promise<LegacyUser[]> {
    return this.legacy("PUT", siteRef, `/rest/user/${userId}`, patch);
  }
  /** Devices with full config (legacy API) — includes `radio_table` for APs. */
  listLegacyDevices(siteRef: string): Promise<LegacyDevice[]> {
    return this.legacy("GET", siteRef, "/stat/device");
  }
  /** Replace a device's radio settings. `radioTable` must be the full table, not just the changed entry. */
  updateRadioTable(siteRef: string, deviceId: string, radioTable: LegacyRadio[]): Promise<LegacyDevice[]> {
    return this.legacy("PUT", siteRef, `/rest/device/${deviceId}`, { radio_table: radioTable });
  }
}
