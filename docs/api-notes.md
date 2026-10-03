# UniFi Network Integrations API — field notes

Observations from developing against a Cloud Gateway Ultra (UniFi OS 5.1.19, Network 10.4.x). Official docs: https://developer.ui.com/

## Base URL and auth

```
https://<gateway>/proxy/network/integration/v1/...
X-API-KEY: <console-local key>
```

- The gateway serves a self-signed certificate on its LAN IP; clients must skip verification or use the `<id>.id.ui.direct` hostname (valid cert, resolves to the LAN IP).
- **Cloud keys don't work locally.** Keys minted at unifi.ui.com → API Keys authenticate against `api.ui.com` (Site Manager API) only; the local Integrations API returns `{"error":{"code":401,"message":"Unauthorized"}}` for them. Console-local keys are created in the gateway's local UI (`/network/default/integrations` on Network 10.x).

## Pagination

List endpoints return:

```json
{ "offset": 0, "limit": 25, "count": 1, "totalCount": 1, "data": [ ... ] }
```

`limit` can be raised via query params (`?offset=0&limit=200`). Iterate until `offset >= totalCount`.

## Endpoints used by this CLI

| Endpoint | Notes |
|---|---|
| `GET /v1/info` | `{ "applicationVersion": "10.4.57" }` |
| `GET /v1/sites` | site `id` (UUID), `internalReference` (e.g. `"default"`), `name` |
| `GET /v1/sites/{siteId}/devices` | UniFi hardware only. Fields observed: `id`, `macAddress`, `ipAddress`, `name`, `model`, `state`, `supported`, `firmwareVersion`, `firmwareUpdatable`, `features`, `interfaces`. The gateway's `ipAddress` is its WAN address, not the LAN one. |
| `GET /v1/sites/{siteId}/devices/{id}` | superset of the list entry |
| `GET /v1/sites/{siteId}/devices/{id}/statistics/latest` | `uptimeSec`, `cpuUtilizationPct`, `memoryUtilizationPct`, `lastHeartbeatAt`, uplink rates |
| `GET /v1/sites/{siteId}/clients` | connected clients: `id`, `name`, `type` (`"WIRED"`/`"WIRELESS"`), `ipAddress`, `macAddress`, `connectedAt`, `uplinkDeviceId` |
| `POST /v1/sites/{siteId}/devices/{id}/actions` | body `{"action": "RESTART"}` |
| `POST /v1/sites/{siteId}/devices/{id}/interfaces/ports/{idx}/actions` | body `{"action": "POWER_CYCLE"}` |

## Gotchas

- The API surface varies by Network application version; unknown endpoints 404. Treat 404 as "not supported by this firmware", not as a bug.
- Apple devices with Private Wi-Fi Address enabled appear as multiple clients over time (rotating locally-administered MACs).
- Site-scoped endpoints want the site's UUID `id`, not `internalReference`.

## Legacy Network API (also works with the API key)

Observed on Network 10.6: the pre-Integrations API that the web UI uses,
`https://<gateway>/proxy/network/api/s/<internalReference>/...`, accepts the
same console-local `X-API-KEY`. Responses are `{ "meta": { "rc": "ok" }, "data": [ ... ] }`.
Note the site segment is the `internalReference` (`default`), not the UUID.

Used for DHCP reservations, which the Integrations API cannot set:

| Endpoint | Notes |
|---|---|
| `GET /rest/user` | every client the controller has ever seen: `_id`, `mac`, `name`, `hostname`, `use_fixedip`, `fixed_ip`, `network_id` |
| `GET /rest/networkconf` | networks: `_id`, `name`, `purpose` (`corporate` = LAN, `wan`), `ip_subnet` (`192.168.0.1/24`) |
| `PUT /rest/user/{_id}` | partial update; `{ "use_fixedip": true, "fixed_ip": "…", "network_id": "…", "name": "…" }` reserves, `{ "use_fixedip": false }` clears |

A reservation applies at the client's next DHCP renewal. Apple devices using a
Private Wi-Fi Address present a locally-administered MAC (second hex digit
2/6/A/E); the reservation is bound to that MAC, so it survives only while the
device keeps it (macOS default is "Fixed" per network; "Rotating" breaks it).

### Wi-Fi radio settings

The Integrations API exposes radios read-only (`interfaces.radios[]` on the
device detail). `unifi radios` / `unifi radio set` use the legacy API instead:

| Endpoint | Notes |
|---|---|
| `GET /stat/device` | full device objects; APs carry `radio_table[]` (configured) and `radio_table_stats[]` (live) |
| `PUT /rest/device/{_id}` | body `{ "radio_table": [ ... ] }` → `{ "meta": { "rc": "ok" }, "data": [device] }` |

`radio_table[]` entries: `name` (`wifi0`/`wifi1`/`wifi2`), `radio` (`ng` = 2.4 GHz,
`na` = 5 GHz, `6e` = 6 GHz), `channel` (`"auto"` or a number), `ht` (width in MHz
as a string: `"20"`…`"320"`), `tx_power_mode` (`auto`/`low`/`medium`/`high`/`custom`;
absent means auto), `tx_power`, plus capability fields (`has_ht160`, `max_txpower`, …).
`radio_table_stats[]` has the radio's current `channel`, `bw` (width), `tx_power`
and `num_sta` (clients), matched to the config entry by `name`.

The PUT replaces the whole table, so send every radio back (modified entry
included), not just the one you changed. Applying a change restarts that radio,
briefly disconnecting its clients. Widths: 2.4 GHz 20/40, 5 GHz 20–160, 6 GHz 20–320
(the AP model may support less).
