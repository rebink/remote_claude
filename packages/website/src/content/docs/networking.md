---
title: Networking
description: How your laptop reaches the remote, with Tailscale or a plain LAN.
---

Patchwire isn't opinionated. It just needs SSH and HTTP reachability from the laptop to whatever hostname you put in `patchwire.yml`. Pick the option that fits.

## At a glance

| Setup | Cost | Best for | Internet-exposed? |
| --- | --- | --- | --- |
| **Same LAN** | free | Both machines on home Wi-Fi or Ethernet | No |
| **Tailscale** ⭐ | free (personal) | Working from anywhere | No |
| **Self-hosted WireGuard** | free | You want to own the tunnel | No |
| **Cloudflare Tunnel** | free | OK with Cloudflare in path | No |
| **Router port-forward + DDNS** | free | Avoid. Exposes SSH publicly. | **Yes** |

## Recommended: Tailscale

```bash
brew install tailscale
sudo tailscale up
```

Each machine gets a stable tailnet IP and a Magic-DNS hostname. Drop the hostname into `patchwire.yml`:

```yaml
remote:
  host: <your-remote-host>
  agentUrl: http://<your-remote-host>:7878
```

`patchwire setup` calls `tailscale status --json` and lets you pick the remote from a list, so you don't need to type the IP.

### Why Tailscale for this use case

1. **Never internet-exposed.** Your agent listens only on the tailnet, so random scanners can't reach it.
2. **Stable hostnames.** Magic DNS survives Wi-Fi changes, ISP changes, and NAT.
3. **Zero infrastructure.** No router config. No port forwards. Works from cafés.
4. **Layered defense.** Bearer-token auth and SSH keys still apply on top of the tunnel.
5. **Free for personal use** (up to 100 devices and 3 users on the personal plan).

### Locking the agent down further

If you want belt-and-braces:

```bash
# bind the agent only to the Tailscale interface
export PW_AGENT_HOST=<your-tailnet-ip>   # the remote's tailnet IP
patchwire-agent install --host <your-tailnet-ip>
```

Or, even tighter: bind to `127.0.0.1` and run `tailscale serve` to expose a single named endpoint into the tailnet. See [Tailscale Serve docs](https://tailscale.com/kb/1242/tailscale-serve).

## Same LAN

If both machines are on the same network, you can skip the VPN entirely:

```yaml
remote:
  host: <your-lan-ip>           # the remote's LAN IP
  agentUrl: http://<your-lan-ip>:7878
```

Caveats:

- IPs change. If your remote gets a new DHCP lease, your config breaks. Either reserve its IP on the router, or use mDNS like `<your-host>.local`.
- Doesn't help when you're on the road. You'll either reconfigure when you travel, or switch to Tailscale.

## Self-hosted WireGuard

If you'd rather not depend on Tailscale's coordination server, run vanilla WireGuard between the two boxes. Setup is non-trivial (key exchange, AllowedIPs, NAT traversal). Only worth it if you have a reason. Once it's up, treat it like LAN.

## Cloudflare Tunnel (`cloudflared`)

Run `cloudflared tunnel` on the remote and expose the agent at a custom subdomain. Pros: no router changes, plus auth via Cloudflare Access if you want SSO. Cons: Cloudflare sees your traffic, and it's one more dependency.

## Why we don't recommend port forwarding

Forwarding port 22 or 7878 from your home router to the remote works. It also:

- Puts SSH on the public internet, where it gets brute-forced 24/7.
- Requires DDNS setup if your ISP doesn't give you a static IP.
- Makes the bearer-token auth your *only* defense in depth.

If you must, at least restrict source IPs at the router and put the agent behind nginx with TLS. Even then, Tailscale is easier and safer.

## Switching networks later

The whole "network plane" is a single hostname in `patchwire.yml`. Moving from LAN to Tailscale to WireGuard is a one-line edit. Re-run `patchwire doctor` to verify, and you're done.
