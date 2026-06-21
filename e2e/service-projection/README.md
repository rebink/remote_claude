# Service Projection — real-ssh E2E (no remote host needed)

Spins a throwaway **sshd container** as the stand-in "remote agent host" and a
host **Postgres** container, then runs the real `patchwire services` flow:
`discover` → `bind` (real `ssh -R`) → `psql` from inside the container proves a
tunnelled query reaches the host DB. Also exercises the same-port-conflict
**remap** and supervised **auto-heal** paths.

Run: `bash e2e/service-projection/run.sh` (needs Docker running locally).

Uses an isolated `$HOME` under a temp dir, generates a throwaway ed25519 key
(never committed — see build/.gitignore), and tears everything down on exit.
