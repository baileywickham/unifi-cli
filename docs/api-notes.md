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
