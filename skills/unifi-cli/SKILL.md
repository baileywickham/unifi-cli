---
name: unifi-cli
description: Use when asked about UniFi network gear or the local network — access points, gateway, switches, WiFi, or which clients/devices are connected. Queries the local UniFi gateway via the `unifi` CLI.
---

# unifi-cli

CLI for the UniFi Network Integrations API on a local UniFi gateway
(Cloud Gateway Ultra, UDM, UDR, etc.).

## Prerequisites

- `unifi` is on PATH. `bun link` installs it to `~/.bun/bin`, which is not on
  PATH when Bun came from Homebrew — try `~/.bun/bin/unifi` before assuming
  it's missing.
  If it isn't installed, install it (requires [Bun](https://bun.sh)):

      git clone https://github.com/baileywickham/unifi-cli
      cd unifi-cli && bun install && bun link

- API key in `UNIFI_API_KEY` or `~/.config/unifi-cli/config.json`. If missing,
  the CLI prints setup instructions — relay them to the user instead of guessing.
  (Keys must be created in the gateway's local web UI, not unifi.ui.com — the
  CLI's error output and the repo README explain this.)

## Commands

Prefer `--json` when you need to parse the output.

    unifi devices --json                 # all UniFi hardware: model, IP, state
    unifi device <name|id>               # one device: detail + uptime/cpu/memory
    unifi clients [--wired|--wireless] [--all]   # connected clients (--all: plus known offline ones)
    unifi client <name|ip|mac>           # one client + its DHCP reservation; falls back to
                                         # known offline clients with first/last seen
    unifi client fixed-ip <client> <ip|off> [--name label]   # DHCP reservation (write action)
    unifi radios [<device>]              # AP radios: band, channel/width (configured vs now), tx power
    unifi radio set <device> <2.4|5|6> [--width N] [--channel N|auto] [--tx-power low|medium|high|auto]   # (write action)
    unifi neighbors [--band 5] [--hours 24]  # neighboring networks per channel, as the APs hear them
    unifi smartq                         # Smart Queues (SQM) on/off and rates per WAN
    unifi smartq set <down Mbps> <up Mbps> | off [--wan name]   # (write action)
    unifi portforwards                   # port-forward rules: enabled, proto, port, target, source
    unifi portforward enable|disable <name|id>   # (write action)
    unifi upnp                           # UPnP / NAT-PMP on or off
    unifi sites                          # sites (usually just "default")
    unifi info                           # network application version

Typical questions this answers: "what APs do I have?" → `unifi devices`;
"is the living room AP up?" → `unifi device living-room`;
"what's on my network?" → `unifi clients`;
"give the Mac a fixed IP" → `unifi client fixed-ip <ip-or-mac> <new-ip> --name <label>`
(applies at the client's next DHCP renewal; on a Mac `sudo ipconfig set en0 DHCP`
renews it);
"what channel/width is the 5 GHz on?" → `unifi radios`;
"set 5 GHz to 80 MHz" → `unifi radio set <ap> 5 --width 80` (valid widths: 2.4 GHz 20/40,
5 GHz 20/40/80/160, 6 GHz up to 320; applying briefly drops that radio's clients);
"which channel is least crowded?" → `unifi neighbors --band 5 --hours 24` plus the BUSY/RETRIES
columns of `unifi radios` (an AP hears only its own channel, so pair it with a client-side scan,
e.g. `system_profiler SPAirPortDataType` on a Mac);
"calls lag when someone uploads" (bufferbloat) → `unifi smartq set <down> <up>` at ~90% of a
measured speed test (`networkQuality -s` on a Mac);
"is that device still around / when was it last here?" → `unifi client <name|ip|mac>`
(or `unifi clients --all`);
"what's exposed to the internet?" → `unifi portforwards` and `unifi upnp`.

## Write actions — ask the user first

`unifi device restart <name>`, `unifi device power-cycle <name> <port>`,
`unifi client fixed-ip …`, `unifi radio set …`, `unifi smartq set|off` and
`unifi portforward enable|disable …` change the network (enabling a port forward exposes a LAN host to the internet). NEVER run them unless the user
explicitly asked for that action in this conversation. These commands prompt interactively, so when
running them from Claude pass `--yes` — but only after the user has explicitly
confirmed the action in the conversation.
