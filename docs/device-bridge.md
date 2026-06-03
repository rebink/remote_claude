# Android device bridge (`patchwire device`)

Run your Flutter build on the remote toolchain but deploy + hot-reload to the
Android phone in your hand, over Tailscale. **Android only** — iOS real-device
debugging needs a Mac and is not bridged.

## Prerequisites
- `adb` (Android platform-tools) on your laptop.
- The phone on your Tailscale tailnet (Tailscale app, logged into the same tailnet).
- The phone connected to the laptop over **USB** for the one-time switch to TCP mode.
- USB debugging enabled + authorized (accept the prompt on the phone).

## Use
```
patchwire device doctor     # verify adb, tailscale, and an authorized phone
patchwire device connect    # switch the phone to TCP mode + print the remote command
```
`connect` prints an `adb connect <phone-tailscale-ip>:5555` line to run **on the
remote host**, then `flutter run -d <phone-tailscale-ip>:5555` builds to the phone
with USB-equivalent hot reload + breakpoints.

Flags: `--device <serial>` (multiple phones attached), `--name <peer>` (pick the
Tailscale peer), `--port <n>` (default 5555).

## Security — required
adb-over-TCP has **no authentication**. Restrict the adb port to your remote host
with a Tailscale ACL, e.g.:
```jsonc
// tailnet policy (Access Controls)
{
  "acls": [
    { "action": "accept", "src": ["<remote-host>"], "dst": ["<phone>:5555"] }
  ]
}
```
Without an ACL, any tailnet device could drive the phone's adb.

## Caveats
- `tcpip` mode resets when the phone reboots — re-run `patchwire device connect`
  over USB afterwards.
- TCP adb is slower / less stable than a cable; prefer USB when co-located.
- The device loop is per-developer-per-device — it cannot be pooled on one shared box.
