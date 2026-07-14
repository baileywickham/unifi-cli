# unifi-cli

A small, zero-dependency Bun CLI for the [UniFi Network Integrations API](https://developer.ui.com/) on UniFi gateways (Cloud Gateway Ultra, UDM, UDR, etc.), plus an optional [Claude Code](https://claude.com/claude-code) skill so an AI session can answer questions about your network by running it.

```
$ unifi devices
NAME                 MODEL      IP             STATE   FIRMWARE
Cloud Gateway Ultra  UCG Ultra  203.0.113.10   ONLINE  5.1.19
U7 Lite              U7 Lite    192.168.1.252  ONLINE  8.6.11
```

## Features

- `unifi info` — Network application version
- `unifi sites` — list sites
- `unifi devices` — all UniFi hardware (gateway, switches, APs) with model/IP/state/firmware
- `unifi device <name|id>` — device detail plus live stats (uptime, CPU, memory)
- `unifi clients [--wired|--wireless]` — every client on the network
- `unifi device restart <name|id>` — restart a device (asks for confirmation)
- `unifi device power-cycle <name|id> <port>` — power-cycle a PoE port (asks for confirmation)
- `--json` on any read command for the raw API response, `--site` to pick a site, `--yes` to skip confirmations in scripts

Zero runtime npm dependencies. Self-signed gateway certificates are accepted (it's a LAN device). Paginated endpoints are fetched fully and transparently.

## Install

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/baileywickham/unifi-cli && cd unifi-cli
bun install
bun link          # puts `unifi` on your PATH (via ~/.bun/bin)
```

## Getting an API key (read this — it's the one tricky part)

The Integrations API only accepts **console-local** API keys. Keys created at unifi.ui.com → API Keys are **cloud keys**: they work against `api.ui.com`, but the gateway's local API will return `401 Unauthorized` for them.

Create a local key in the gateway's **local** web UI:

- **Network 10.x:** `https://<gateway-ip>/network/default/integrations` → Create New API Key
- **Network 9.x:** Settings → Control Plane → Integrations → Create API Key

Note: the cloud-proxied UI at unifi.ui.com hides this page — you must be on the gateway's own UI. If your browser blocks the gateway's self-signed certificate, use the console's `https://<id>.id.ui.direct` hostname shown on its login screen, which carries a valid certificate and resolves to the LAN IP.

## Configuration

Environment variables win over the config file:

```sh
export UNIFI_API_KEY=<your key>
export UNIFI_GATEWAY=https://192.168.1.1    # optional, defaults to https://192.168.0.1
```

or `~/.config/unifi-cli/config.json`:

```json
{ "gateway": "https://192.168.1.1", "apiKey": "<your key>", "defaultSite": "default" }
```

The config file holds a credential — `chmod 600` it.

## Usage

```sh
unifi devices                        # which APs/switches do I have, are they up?
unifi device living-room             # one device: detail + uptime/cpu/memory
unifi clients --wireless             # who's on WiFi right now
unifi clients --json                 # full client objects (incl. uplink AP id)
unifi device restart living-room     # prompts y/N before acting
unifi --help
```

Exit code is non-zero on any error, and errors are printed as `unifi: <message>`, so it composes well in scripts. A 404 from the gateway is reported as possibly unsupported firmware — the Integrations API surface varies by Network application version (developed against Network 10.4 on a Cloud Gateway Ultra).

See [docs/api-notes.md](docs/api-notes.md) for field notes on the API itself (auth gotchas, pagination, observed payload shapes).

## Claude Code skill

The easiest way is the plugin marketplace:

```
/plugin marketplace add baileywickham/claude-plugins
/plugin install unifi-cli@baileywickham
```

Or, from a clone of this repo:

```sh
bun run install-skill   # copies skills/unifi-cli/ → ~/.claude/skills/unifi-cli
```

Either way, any Claude Code session on your machine knows how to answer "what APs do I have?" or "is my iPhone on WiFi?" by running the CLI. The skill hard-codes a safety rule: it never runs `restart`/`power-cycle` (and never passes `--yes`) unless you explicitly asked for that action in the conversation.

## Development

```sh
bun test          # 40 tests, no network needed (injectable fetch)
```

`src/api.ts` is the only file that talks HTTP; commands are pure functions over an injected client, which is what makes the suite fast and offline.

## License

MIT
