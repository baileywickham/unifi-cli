import type { AppInfo, Client, Device, DeviceDetail, DeviceStats, Page, Site } from "./types";

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.gateway}/proxy/network/integration${path}`;
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
}
