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

/** Legacy Network API: one entry of a device's `radio_table` (configured settings). */
export interface LegacyRadio {
  name: string; // "wifi0" | "wifi1" | "wifi2"
  radio: string; // "ng" (2.4 GHz) | "na" (5 GHz) | "6e" (6 GHz)
  channel?: string | number; // "auto" or a channel number
  ht?: string | number; // channel width in MHz, as a string ("20" … "320")
  tx_power_mode?: string; // "auto" | "low" | "medium" | "high" | "custom"; absent = auto
  tx_power?: string | number;
  [key: string]: unknown;
}

/** Legacy Network API: one entry of `radio_table_stats` (what the radio is doing now). */
export interface LegacyRadioStats {
  name: string;
  radio: string;
  channel?: number;
  bw?: number;
  tx_power?: number;
  num_sta?: number;
}

/** Legacy Network API: /proxy/network/api/s/<site>/stat/device */
export interface LegacyDevice {
  _id: string;
  mac: string;
  name?: string;
  model?: string;
  type?: string; // "uap" | "usw" | "udm" ...
  radio_table?: LegacyRadio[];
  radio_table_stats?: LegacyRadioStats[];
}
