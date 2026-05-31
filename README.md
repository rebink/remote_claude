# Patchwire — Monorepo

[![CI](https://github.com/rebink/patchwire/actions/workflows/ci.yml/badge.svg)](https://github.com/rebink/patchwire/actions/workflows/ci.yml)
[![Docs](https://github.com/rebink/patchwire/actions/workflows/docs.yml/badge.svg)](https://github.com/rebink/patchwire/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](#requirements)

> **Local-first development. AI executes remotely. Diffs come back for review.**

You keep coding on your laptop with full IDE speed. A bigger Mac (or any remote box) runs Claude Code with full repo context. The result comes back as a **unified diff** that you preview and `git apply` — no surprise file edits, no commits you didn't see.

**Full docs:** [patchwire.vercel.app](https://patchwire.vercel.app)

## Packages

| Package | Path | Description |
|---|---|---|
| `patchwire` | [`packages/cli`](packages/cli) | Laptop CLI + remote agent daemon (two npm bins, one package) |
| `patchwire-vscode` | [`packages/extension`](packages/extension) | VS Code extension — chat panel + setup wizard + sync controller |
| `patchwire-docs` | [`packages/website`](packages/website) | Astro/Starlight docs site, deployed to Vercel |
| `@patchwire/protocol` | [`packages/protocol`](packages/protocol) | Private workspace package — wire types shared by `cli` and `extension` |

## Requirements

- Node.js ≥ 20
- pnpm ≥ 10 (`npm i -g pnpm`)

## Workspace commands

From the repository root:

```bash
pnpm install           # install all workspace dependencies
pnpm -r build          # build every package
pnpm -r test           # run all unit tests
pnpm -r typecheck      # typecheck every package

pnpm cli <args>        # shorthand for pnpm --filter patchwire <args>
pnpm extension <args>  # shorthand for pnpm --filter patchwire-vscode <args>
pnpm website <args>    # shorthand for pnpm --filter patchwire-docs <args>
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local dev workflow, smoke tests, and release notes. Implementation specs and historical plans live under [`docs/specs`](docs/specs) and [`docs/plans`](docs/plans).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
