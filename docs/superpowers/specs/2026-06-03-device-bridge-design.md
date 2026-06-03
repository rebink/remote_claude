# Milestone 4 — Android device bridge (`patchwire device`)

**Date:** 2026-06-03
**Status:** Approved design, ready for plan
**Part of:** production-readiness sequence (milestone 4 of 4, final). Prev: usage, policy, release hardening (done).

---

## Decisions (from brainstorm)
- **Shape:** a guided `patchwire device` command (laptop CLI) with a `device doctor` preflight and a `device connect` flow. A **pure, testable core** does the parsing/selection/command-building; the command wires it to `adb` + Tailscale via **injectable deps** so the orchestration is unit-tested without hardware.
- **Remote trigger:** the CLI **prints the exact `adb connect …` command** for the user to run on the remote (no SSH execution, no new agent endpoint).
- **Android only.** iOS has no adb equivalent (needs a Mac) — explicitly out of scope, stated in output + docs.

## Honest scope / verifiability
This bridges *physical hardware* (a USB Android phone + Tailscale + adb + Flutter). **CI tests cover only the pure logic and the orchestration with faked deps.** The live loop (remote `flutter run` → local phone hot reload) can only be verified by the user on real hardware. v1 deliberately does the safe local steps and *prints* the remote command rather than claiming an unverified end-to-end automation.

## The recipe being automated (verified in `docs/build-vs-buy-and-remote-flutter.md`)
Local `adb -s <serial> tcpip 5555` (over USB) → phone on Tailscale → remote `adb connect <phone-tailscale-ip>:5555` → `flutter run -d <phone-ip>:5555` on the remote deploys to the local phone with USB-equivalent hot reload. Caveats surfaced to the user: tcpip mode resets on phone reboot; **lock down port 5555 with Tailscale ACLs**; slower/less stable than a cable.

## Architecture

### Pure core — `lib/device-bridge.ts` (no I/O)
```ts
interface AdbDevice { serial: string; state: string }            // state: 'device' | 'unauthorized' | 'offline' | …
type Pick<T> = { ok: true; value: T } | { ok: false; error: string }

parseAdbDevices(stdout: string): AdbDevice[]
selectAndroidDevice(devices: AdbDevice[], serial?: string): Pick<AdbDevice>   // exactly one authorized device, honoring --device
selectAndroidPeer(peers: TailscalePeer[], name?: string): Pick<TailscalePeer> // online android peer w/ ipv4, honoring --name
tcpipArgs(serial: string, port: number): string[]                // ['-s', serial, 'tcpip', '5555']
connectCommand(host: string, port: number): string              // 'adb connect 100.x.y.z:5555'
buildBridgePlan(device, peer, port): { remoteConnect: string; flutterHint: string; warnings: string[] }
```
`TailscalePeer` is imported from the existing `lib/tailscale.ts`.

### Command — `commands/device.ts` with injectable deps
```ts
interface DeviceDeps { runAdb(args: string[]): { stdout: string; status: number }; tailscaleStatus(): TailscaleStatus }
registerDeviceCommands(program: Command, deps: DeviceDeps = realDeps): void
```
- `device doctor` — checklist: adb present (`runAdb(['version'])` status 0), Tailscale running (`deps.tailscaleStatus().running`), one authorized Android device (`parseAdbDevices` + `selectAndroidDevice`). Prints pass/fail lines (mirrors `commands/doctor.ts` style).
- `device connect [--device <serial>] [--port <n=5555>] [--name <tailscale-name>]`:
  1. `parseAdbDevices(runAdb(['devices']).stdout)` → `selectAndroidDevice(…, opts.device)`; on `!ok`, print error + exit non-zero.
  2. `runAdb(tcpipArgs(serial, port))` to switch the device to TCP mode.
  3. `selectAndroidPeer(tailscaleStatus().peers, opts.name)`; on `!ok`, print guidance + exit.
  4. Print `buildBridgePlan(...)`: the remote `adb connect <ip>:<port>` command, the `flutter run -d <ip>:<port>` hint, and the warnings (ACL lockdown, reboot resets tcpip, Android-only).
- `realDeps`: `runAdb` = `spawnSync('adb', args, {encoding:'utf8'})` mapped to `{stdout, status}`; `tailscaleStatus` from `lib/tailscale.ts`.
- Registered in `cli.ts` (laptop binary) alongside the other commands.

### Docs — `docs/device-bridge.md`
The verified runbook + the security guidance (Tailscale ACL example for port 5555), the Android-only note, and the reboot caveat.

## Out of scope
- iOS; SSH/agent execution of the remote connect; pooling devices; Flutter wrapper/`flutter run` automation; website changes (the proving-ground roadmap teaser stays as-is until hardware-verified).

## Success criteria
- `lib/device-bridge.ts` pure functions unit-tested: parse (incl. unauthorized/offline lines, empty), device selection (none / one / multiple / by-serial / unauthorized), peer selection (none / one / multiple / by-name), command builders, plan.
- `device connect` with **faked deps** prints the correct `adb connect <ip>:<port>` for a happy-path fixture, and exits non-zero with a helpful message when no device / no peer.
- `device doctor` runs the three checks against faked deps.
- `patchwire device --help` lists `doctor` and `connect`.
- `pnpm --filter patchwire test/typecheck/build` green; existing tests unaffected.
- README/`docs/device-bridge.md` document the Android-only scope + ACL warning.

## Affected files
- Create: `packages/cli/src/lib/device-bridge.ts`, `packages/cli/src/commands/device.ts`, `packages/cli/test/lib/device-bridge.test.ts`, `packages/cli/test/commands/device.test.ts`, `docs/device-bridge.md`
- Modify: `packages/cli/src/cli.ts` (register the command group)
