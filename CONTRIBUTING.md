# Contributing to Remote Claude

Thanks for your interest! Bug reports, feature ideas, and PRs are all welcome.

## Quick start

```bash
git clone https://github.com/rebink/remote_claude.git
cd remote_claude
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Development

- Source: `src/` (CLI in `src/cli.ts`, agent in `src/agent.ts`).
- Tests: `test/*.test.ts` (vitest). Add a test before a fix when feasible.
- Lint = TypeScript strict mode (`pnpm typecheck`).
- Build = `pnpm build` (tsup → `dist/`).

## Pull requests

1. Open an issue first for non-trivial changes — quick alignment saves rework.
2. Keep PRs focused (one concern per PR).
3. Include tests for new behavior.
4. `pnpm typecheck && pnpm test && pnpm build` must pass before review.
5. CI runs the same checks on Node 20 and 22.

## Releases

Maintainers cut releases by tagging:

```bash
git tag v0.x.y
git push --tags
```

The `release.yml` workflow runs typecheck + test + build, then publishes to
npm using the `NPM_TOKEN` repository secret.

## Code of conduct

Be kind. Assume good faith. We follow the
[Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
