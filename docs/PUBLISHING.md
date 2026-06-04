# Publishing Patchwire

Patchwire ships through three channels, all driven by **pushing a `vX.Y.Z` git tag**
(`.github/workflows/release.yml`). Each publish step runs **only if its secret is
configured**, so you can enable channels one at a time. The GitHub Release (with the
`.vsix` attached) is always created.

| Channel | Package | Install | Secret needed |
|---|---|---|---|
| npm | `@rebink/patchwire` (CLI) | `npm i -g @rebink/patchwire` | `NPM_TOKEN` |
| VS Code Marketplace | `patchwire.patchwire-vscode` | Extensions panel → "Patchwire" | `VSCE_PAT` |
| Open VSX (Cursor/VSCodium) | `patchwire/patchwire-vscode` | Extensions panel | `OVSX_TOKEN` |

Add the secrets under **GitHub → repo → Settings → Secrets and variables → Actions**.

---

## 1. CLI → npm

   The CLI publishes under the **scoped** name `@rebink/patchwire` (the unscoped
   `patchwire` is taken on npm). The installed binaries are still `patchwire` /
   `patchwire-agent`, so day-to-day commands don't change — only the install id.
1. **Own the scope:** the `@rebink` scope must belong to your npm account/org. Create
   the org (or use your username scope) at npmjs.com if you haven't.
2. **Create a token:** npmjs.com → Access Tokens → *Generate New Token* →
   **Automation**. Add it as the `NPM_TOKEN` repo secret.
3. The workflow publishes with `--access public --provenance` (`--access public` is
   required for scoped packages; provenance needs the `id-token: write` permission
   already set in `release.yml`).
4. **Heads-up — `postinstall`:** the CLI runs `scripts/fetch-sshpass.sh` on install
   (`|| true`, so failures are non-fatal). Some users/CI disable install scripts
   (`npm i -g @rebink/patchwire --ignore-scripts`); the CLI still works, it just won't
   vendor `sshpass` for password-based SSH.

## 2. Extension → VS Code Marketplace

1. **Create the publisher:** sign in at <https://marketplace.visualstudio.com/manage>
   with a Microsoft account and create a publisher with the **exact id `patchwire`**
   (must match `publisher` in `packages/extension/package.json`).
2. **Create a PAT:** in Azure DevOps (<https://dev.azure.com>) → User Settings →
   *Personal Access Tokens* → New, scope **Marketplace → Manage**, org **All
   accessible organizations**. Add it as the `VSCE_PAT` repo secret.
3. The workflow publishes the built `.vsix` with `vsce publish --packagePath`.
   To publish by hand: `cd packages/extension && pnpm build && pnpm exec vsce publish`.

## 3. Extension → Open VSX (for Cursor / VSCodium / Windsurf)

1. Sign in at <https://open-vsx.org> (GitHub), then **claim the `patchwire`
   namespace** (Profile → Namespaces).
2. Create an access token (Profile → Access Tokens). Add it as the `OVSX_TOKEN`
   repo secret.
3. The workflow runs `pnpm exec ovsx publish *.vsix` with `OVSX_PAT` from the secret
   (ovsx is a pinned devDep, not fetched at run time).

---

## Cutting a release

```bash
# bump packages/cli + packages/extension versions (keep them in sync; a test pins
# the CLI VERSION to package.json), update CHANGELOG, commit, then:
git tag v0.3.0
git push origin v0.3.0
```
The workflow builds + tests, packages the `.vsix`, creates the GitHub Release, and
publishes to every channel whose secret is set. Verify after:
- `npm view @rebink/patchwire version`
- Marketplace: <https://marketplace.visualstudio.com/items?itemName=patchwire.patchwire-vscode>
- Open VSX: <https://open-vsx.org/extension/patchwire/patchwire-vscode>

## Local dry-runs (no secrets, nothing published)
```bash
pnpm --filter @rebink/patchwire build && pnpm --filter @rebink/patchwire pack   # npm tarball
pnpm --filter patchwire-vscode build && pnpm --filter patchwire-vscode package  # .vsix
```
