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
  wan_networkgroup?: string; // "WAN" | "WAN2" on WAN networks
  wan_smartq_enabled?: boolean; // Smart Queues (SQM) on this WAN
  wan_smartq_down_rate?: number; // kbps
  wan_smartq_up_rate?: number; // kbps
  [key: string]: unknown;
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
  cu_total?: number; // channel utilization %, all transmitters the radio hears
  tx_retries_pct?: number; // % of frames this radio had to retransmit
}

/** Legacy Network API: /stat/rogueap — a neighboring network one of our radios hears. */
export interface LegacyNeighbor {
  bssid: string;
  essid?: string; // "" for hidden networks
  band: string; // "ng" | "na" | "6e"
  channel: number;
  bw?: number;
  signal?: number; // dBm
  radio_name?: string;
  ap_mac?: string;
  last_seen?: number;
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
