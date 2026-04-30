---
title: Networking
description: How your laptop reaches the Mac Mini — Tailscale, LAN, alternatives.
---

Remote Claude isn't opinionated. It just needs **SSH** and **HTTP** reachability from the laptop to whatever hostname you put in `remote-claude.yml`. Pick the option that fits.

## At a glance

| Setup | Cost | Best for | Internet-exposed? |
| --- | --- | --- | --- |
| **Same LAN** | free | Both machines on home Wi-Fi / Ethernet | No |
| **Tailscale** ⭐ | free (personal) | Working from anywhere | No |
| **Self-hosted WireGuard** | free | You want to own the tunnel | No |
| **Cloudflare Tunnel** | free | OK with Cloudflare in path | No |
| **Router port-forward + DDNS** | free | **Avoid** — exposes SSH publicly | **Yes** |

## Recommended: Tailscale

```bash
brew install tailscale
sudo tailscale up
```

Each machine gets a stable `100.x.y.z` IP and a Magic-DNS hostname like `mac-mini.tail-abc123.ts.net`. Drop that into `remote-claude.yml`:

```yaml
remote:
  host: mac-mini.tail-abc123.ts.net
  agentUrl: http://mac-mini.tail-abc123.ts.net:7878
```

`remote-claude setup` calls `tailscale status --json` and lets you pick the Mini from a list — no IP typing.

### Why Tailscale for this use case

1. **Never internet-exposed.** Your agent listens only on the tailnet — random scanners can't reach it.
2. **Stable hostnames.** Magic DNS survives Wi-Fi changes, ISP changes, NAT.
3. **Zero infrastructure.** No router config. No port forwards. Works from cafés.
4. **Layered defense.** Bearer-token auth + SSH keys still apply on top of the tunnel.
5. **Free for personal use** — up to 100 devices and 3 users on the personal plan.

### Locking the agent down further

If you want belt-and-braces:

```bash
# bind the agent ONLY to the Tailscale interface
export RC_AGENT_HOST=100.x.y.z   # the Mini's tailnet IP
remote-claude-agent install --host 100.x.y.z
```

Or, even tighter: bind to `127.0.0.1` and run `tailscale serve` to expose a single named endpoint into the tailnet. (See [Tailscale Serve docs](https://tailscale.com/kb/1242/tailscale-serve).)

## Same LAN

If both machines are on the same network, you can skip the VPN entirely:

```yaml
remote:
  host: 192.168.1.10           # the Mini's LAN IP
  agentUrl: http://192.168.1.10:7878
```

Caveats:

- IPs change. If your Mini gets a new DHCP lease, your config breaks. Either reserve its IP on the router or use mDNS (`mac-mini.local`).
- Doesn't help when you're on the road. You'll either reconfigure when you travel, or switch to Tailscale.

## Self-hosted WireGuard

If you'd rather not depend on Tailscale's coordination server, run vanilla WireGuard between the two boxes. Setup is non-trivial (key exchange, AllowedIPs, NAT traversal) — only worth it if you have a reason. Once it's up, treat it like LAN.

## Cloudflare Tunnel (`cloudflared`)

Run `cloudflared tunnel` on the Mini and expose the agent at a custom subdomain. Pros: no router changes; auth via Cloudflare Access if you want SSO. Cons: Cloudflare sees your traffic; one more dependency.

## Why we don't recommend port forwarding

Forwarding port 22 or 7878 from your home router to the Mini works. It also:

- Puts SSH on the public internet, where it gets brute-forced 24/7.
- Requires DDNS setup if your ISP doesn't give you a static IP.
- Makes the bearer-token auth your *only* defense in depth.

If you must, at least restrict source IPs at the router and put the agent behind nginx with TLS. Even then — Tailscale is easier and safer.

## Switching networks later

The whole "network plane" is a single hostname in `remote-claude.yml`. Moving from LAN to Tailscale to WireGuard is a one-line edit. Re-run `remote-claude doctor` to verify, and you're done.
