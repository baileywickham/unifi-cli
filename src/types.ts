export interface Page<T> {
  offset: number;
  limit: number;
  count: number;
  totalCount: number;
  data: T[];
}

export interface Site {
  id: string;
  name: string;
  internalReference?: string;
}

export interface Device {
  id: string;
  name: string;
  model: string;
  macAddress: string;
  ipAddress: string;
  state: string;
  firmwareVersion?: string;
}

export interface DeviceDetail extends Device {
  adoptedAt?: string;
  firmwareUpdatable?: boolean;
}

export interface DeviceStats {
  uptimeSec?: number;
  cpuUtilizationPct?: number;
  memoryUtilizationPct?: number;
  lastHeartbeatAt?: string;
}

export interface Client {
  id: string;
  name?: string;
  type: string; // "WIRED" | "WIRELESS" observed
  ipAddress?: string;
  macAddress?: string;
  connectedAt?: string;
  uplinkDeviceId?: string;
}

export interface AppInfo {
  applicationVersion: string;
}

/** Legacy (non-Integrations) Network API: /proxy/network/api/s/<site>/rest/user */
export interface LegacyUser {
  _id: string;
  mac: string;
  name?: string;
  hostname?: string;
  use_fixedip?: boolean;
  fixed_ip?: string;
  network_id?: string;
}

/** Legacy Network API: /proxy/network/api/s/<site>/rest/networkconf */
export interface LegacyNetwork {
  _id: string;
  name: string;
  purpose: string; // "corporate" | "wan" | ...
  ip_subnet?: string; // e.g. "192.168.0.1/24"
}
