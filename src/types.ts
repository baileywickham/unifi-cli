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
