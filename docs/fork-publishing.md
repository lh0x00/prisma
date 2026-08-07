# Forked Prisma — Publishing Guide

End-to-end guide for publishing this fork to npm under the `@vertexa/*` scope,
including **11 JS packages**, **3 WASM packages**, and **1 native binary**
(`schema-engine`) hosted on GitHub Releases.

After publishing, users only need `npm i @vertexa/prisma @vertexa/prisma-client`
— no extra configuration required.

> **Current version**: `7.8.5` (based on Prisma 7.8)
> **Scope**: `@vertexa` (override via `FORK_SCOPE=@your-scope`)
> **GitHub repo**: `lh0x00/prisma` (override via `FORK_GH_REPO=your/repo`)

> **Pipeline scope**: scripts in `scripts/fork/` rebrand 11 JS packages +
> publish 3 WASM packages from `prisma-engines/` + build & upload `schema-engine`
> native for 3 platforms (`darwin-arm64`, `debian-openssl-3.0.x`,
> `linux-musl-openssl-3.0.x`). All other packages (`@prisma/internals`,
> `@prisma/migrate`, `@prisma/client-generator-*`, `@prisma/dmmf`, …) are
> esbuild-bundled into the CLI/Client at build time and do not need separate publishing.

## Name mapping: upstream → fork

### JS packages (rebrand + publish from `packages/`)

| `packages/` folder     | Upstream name                         | Forked name                            |
| ---------------------- | ------------------------------------- | -------------------------------------- |
| `debug`                | `@prisma/debug`                       | `@vertexa/prisma-debug`                |
| `driver-adapter-utils` | `@prisma/driver-adapter-utils`        | `@vertexa/prisma-driver-adapter-utils` |
| `adapter-pg`           | `@prisma/adapter-pg`                  | `@vertexa/prisma-adapter-pg`           |
| `get-platform`         | `@prisma/get-platform`                | `@vertexa/prisma-get-platform`         |
| `engines-version-fork` | `@prisma/engines-version-fork` (stub) | `@vertexa/prisma-engines-version`      |
| `fetch-engine`         | `@prisma/fetch-engine`                | `@vertexa/prisma-fetch-engine`         |
| `engines`              | `@prisma/engines`                     | `@vertexa/prisma-engines`              |
| `config`               | `@prisma/config`                      | `@vertexa/prisma-config`               |
| `client-runtime-utils` | `@prisma/client-runtime-utils`        | `@vertexa/prisma-client-runtime-utils` |
| `client`               | `@prisma/client`                      | `@vertexa/prisma-client`               |
| `cli`                  | `prisma`                              | `@vertexa/prisma`                      |

`packages/engines-version-fork/` is a **new stub** in the fork. `rebrand.ts`
sets `prisma.enginesVersion` to the commit hash of `prisma-engines/` HEAD
(or `FORK_ENGINES_COMMIT`) before publishing. All `@prisma/engines-version`
deps in other packages are automatically rewritten to `@vertexa/prisma-engines-version`.

> **First-time setup**: commit the `packages/engines-version-fork/` directory
> to your fork branch (`git add packages/engines-version-fork && git commit`)
> so `git restore` has a baseline. Subsequent rebrand runs will be cleanly
> reverted by `pnpm fork:restore`.

### WASM packages (built from `prisma-engines/`, published from `<crate>/pkg/`)

| Cargo crate                          | Upstream name                 | Forked name                           |
| ------------------------------------ | ----------------------------- | ------------------------------------- |
| `prisma-schema-wasm`                 | `@prisma/prisma-schema-wasm`  | `@vertexa/prisma-prisma-schema-wasm`  |
| `schema-engine/schema-engine-wasm`   | `@prisma/schema-engine-wasm`  | `@vertexa/prisma-schema-engine-wasm`  |
| `query-compiler/query-compiler-wasm` | `@prisma/query-compiler-wasm` | `@vertexa/prisma-query-compiler-wasm` |

### Native engine binaries (build → host on GitHub Releases)

Only 1 native binary needs forking: **`schema-engine`** (Prisma 7 moved query
work to `query-compiler-wasm`). Default build targets 3 platforms:

| Slug                       | Builder                                        | Rust target                 |
| -------------------------- | ---------------------------------------------- | --------------------------- |
| `darwin-arm64`             | host (Mac M-series)                            | `aarch64-apple-darwin`      |
| `debian-openssl-3.0.x`     | Docker (`Dockerfile.debian-openssl-3.0.x`)     | `x86_64-unknown-linux-gnu`  |
| `linux-musl-openssl-3.0.x` | Docker (`Dockerfile.linux-musl-openssl-3.0.x`) | `x86_64-unknown-linux-musl` |

Assets are uploaded to a GitHub Release under tag `engines-<commit-hash>` with
flat names `<slug>__schema-engine.gz` + `<slug>__schema-engine.gz.sha256`.

`rebrand.ts` patches `packages/fetch-engine/src/utils.ts` so the default URL
points to `https://github.com/<repo>/releases/download/engines-<hash>` using
the pattern `${baseUrl}/${binaryTarget}__${binaryName}${ext}`. Users can still
override via `PRISMA_ENGINES_MIRROR`.

This mapping is declared in `scripts/fork/fork.config.ts` — change `FORK_SCOPE`
via env var to use a different scope (e.g. `FORK_SCOPE=@acme`).

## Prerequisites

- `npm login --scope=@vertexa` (or `NPM_TOKEN` in `~/.npmrc`).
- Node `^20.19 || ^22.12 || >=24.0`, pnpm `>=10.15 <11`.
- Docker daemon running (for the 2 Linux platforms).
- `gh` CLI: `brew install gh && gh auth login` — authenticated to `lh0x00/prisma`.
- ~5 GB free disk (Rust target dirs + node_modules + Docker images).
- Clean working tree under `packages/` (to avoid losing local changes).
- First time only: `git add packages/engines-version-fork && git commit` for baseline.

## Usage

### Quickest — single command end-to-end (full fork: JS + WASM + native)

```bash
FORK_VERSION=7.8.5 pnpm fork:release
```

Pipeline (in order):

1. `fork:install` → `pnpm install`
2. `fork:patch-source` → **pre-build** patches: rewrite `fetch-engine/src/utils.ts` (default URL → GitHub Release flat-asset) + stamp `engines-version-fork/package.json#prisma.enginesVersion` from `prisma-engines/` HEAD
3. `fork:build` → `pnpm build` (turbo build with patches applied, devDeps chain intact)
4. `fork:rebrand` → **post-build** rebrand: rename `name` of 11 packages, rewrite bundle output, drop `devDependencies`, drop dangerous lifecycle scripts
5. `fork:engines:build:wasm` → Docker build 3 WASM crates (5 providers × 2 modes for query-compiler)
6. `fork:engines:build:native` → build `schema-engine` for 3 platforms (host + Docker)
7. `fork:engines:upload` → `gh release upload` to tag `engines-<hash>`
8. `fork:engines:publish:wasm` → rename + `npm publish` 3 WASM packages
9. `fork:publish` → `npm publish --ignore-scripts` 11 JS packages in topo order
10. `fork:restore` → revert all local changes (git restore tracked + reset stub `enginesVersion`)

> **Why split `patch-source` ↔ `rebrand`**: If `rebrand` runs before build, it
> strips `devDependencies` from `@vertexa/prisma-client`, causing Turborepo to
> lose the dep chain signal `client → internals → get-dmmf` (chained via devDeps).
> Result: turbo schedules in parallel → race condition → build fails with
> `Could not resolve "@prisma/get-dmmf"`. Therefore `rebrand` must run **after** build.

### Dry-run (safe — no npm/Docker/GitHub side effects)

```bash
FORK_VERSION=7.8.5 pnpm fork:release:dry
```

All `npm publish`, `docker build`, `docker run`, `gh release upload` commands
are printed to console but not executed.

### JS-only (skip engines, use upstream Prisma CDN)

```bash
FORK_VERSION=7.8.5 pnpm fork:release:js-only
```

Skips engine build/upload + WASM publish. Users installing the fork will fetch
Rust binaries from `binaries.prisma.sh` (upstream Prisma). Note: to use this
mode, you must **not** run the `fork:rebrand` fetch-engine patch — see note above.

### Step-by-step

```bash
# 0. Install deps (once)
pnpm install

# 1. Pre-build source patches (fetch-engine URL + engines-version stub)
FORK_VERSION=7.8.5 pnpm fork:patch-source

# 2. Build JS bundles (turbo) with patches applied
pnpm fork:build

# 3. Post-build rebrand (rename package.json + rewrite bundle output)
FORK_VERSION=7.8.5 pnpm fork:rebrand

# 4. Build + upload Rust engines (~30-60 min first time)
FORK_VERSION=7.8.5 pnpm fork:engines:build:wasm
FORK_VERSION=7.8.5 pnpm fork:engines:build:native
FORK_VERSION=7.8.5 pnpm fork:engines:upload
FORK_VERSION=7.8.5 pnpm fork:engines:publish:wasm

# 5. Verify before pushing JS to npm
pnpm fork:publish:dry

# 6. Publish for real
pnpm fork:publish              # or: pnpm fork:publish --tag next

# 7. Restore source
pnpm fork:restore
```

### Publish a single package (quick debug)

```bash
FORK_VERSION=7.8.5 pnpm fork:rebrand
FORK_ONLY=prisma-debug pnpm fork:publish:dry
```

### Build a single platform / WASM crate

```bash
# Native: only darwin-arm64 (skip Docker)
pnpm fork:engines:build:native --only darwin-arm64

# WASM: only schema-engine-wasm
FORK_VERSION=7.8.5 pnpm fork:engines:build:wasm --only prisma-schema-engine-wasm
```

## Configuration (env / flags)

| Env                   | Flag         | Default                                                      | Description                                                    |
| --------------------- | ------------ | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `FORK_VERSION`        | `--version`  | (required)                                                   | Semver version assigned to all forked packages                 |
| `FORK_SCOPE`          | `--scope`    | `@vertexa`                                                   | npm scope                                                      |
| `FORK_TAG`            | `--tag`      | `latest`                                                     | dist-tag passed to `npm publish`                               |
| `FORK_DRY_RUN`        | `--dry-run`  | `false`                                                      | Enable dry-run for all scripts                                 |
| `FORK_ONLY`           | `--only`     | (all)                                                        | Only publish listed slugs (e.g. `prisma-debug,prisma-engines`) |
| `FORK_OTP`            | `--otp`      | —                                                            | Forward OTP for 2FA                                            |
| `FORK_REGISTRY`       | `--registry` | —                                                            | Forward registry URL                                           |
| `FORK_GH_REPO`        | `--repo`     | `lh0x00/prisma`                                              | GitHub repo hosting engine binaries                            |
| `FORK_ENGINES_COMMIT` | `--commit`   | `git -C prisma-engines rev-parse HEAD`                       | Commit hash for engines-version + release tag                  |
| `FORK_ENGINE_TARGETS` | —            | `darwin-arm64,debian-openssl-3.0.x,linux-musl-openssl-3.0.x` | Comma-separated platforms for native build                     |
| `FORK_WASM_BUILDER`   | `--builder`  | `docker`                                                     | `host` or `docker`                                             |
| `WASM_BUILD_PROFILE`  | `--profile`  | `release`                                                    | Cargo profile for WASM build                                   |

## How end users consume the fork

```bash
npm i -D @vertexa/prisma
npm i    @vertexa/prisma-client
```

The generator output (`prisma generate`) will automatically
`require('@vertexa/prisma-client/runtime/library')` because the bundle output
has been rewritten — this is why `fork:rebrand` must run **after** `fork:build`.

## How the scripts work (summary)

`scripts/fork/rebrand.ts` does exactly 2 things for each of the 11 packages:

1. **Patch `package.json`**:
   - Rename `name` → forked name.
   - Set `version` = `FORK_VERSION`.
   - Rewrite keys in `dependencies` / `peerDependencies` /
     `optionalDependencies` / `peerDependenciesMeta` for names in the mapping;
     replace `workspace:*` of fork-deps with `^FORK_VERSION`.
   - **Delete** `devDependencies` (contains `workspace:*` entries that can't be
     published and aren't needed for `npm install` — all generator/internals
     are bundled).
   - Delete dangerous lifecycle scripts (`prepublishOnly`, `prepare`, `prepack`,
     `postpublish`) to prevent re-triggering builds during `npm publish`.
   - Ensure `publishConfig.access = "public"`.

2. **Rewrite bundle output**:
   - Walk `build/`, `dist/`, `runtime/`, `generator-build/`, `prisma-client/`,
     `install/`, `preinstall/`, `download/`, `scripts/`, …
   - Replace literal strings `@prisma/client`, `@prisma/engines`, `prisma`, …
     (limited to positions bounded by `"`/`'`/`` ` ``/`/` to avoid touching
     random variable names) with the corresponding forked name.
   - Skip `package.json` (already handled in step 1) to avoid double-encoding.

`scripts/fork/publish-fork.ts` runs `npm publish --ignore-scripts` for each
package in topological order: `debug → driver-adapter-utils → adapter-pg →
get-platform → engines-version → fetch-engine → engines → config →
client-runtime-utils → client → cli`.

## When to modify the scripts

- To publish an additional package (e.g. `@prisma/instrumentation`):
  add an entry to `FORK_PACKAGES` in `scripts/fork/fork.config.ts`. Place it
  at the correct topological position (after packages it depends on).
- To change scope: set `FORK_SCOPE=@your-scope` (no code changes needed).
- To keep certain packages under their original names: remove the
  corresponding entry from `FORK_PACKAGES`.

## Troubleshooting

- `Working tree is dirty under packages/`: run `pnpm fork:restore` or
  commit/stash local changes first.
- `npm publish` returns `403 Forbidden`: check `npm whoami`, ensure the
  `@vertexa` scope belongs to your account (or org you have access to).
- `npm publish` returns `cannot publish over previously published version`:
  bump `FORK_VERSION` (e.g. `7.8.6`).
- Engine download fails for users: verify that `@prisma/engines-version` in
  `packages/engines/package.json` of the fork still points to a valid version
  on npm — this is the source-of-truth for the Rust binary download URL.
