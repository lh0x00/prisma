/**
 * Fork publishing config
 * --------------------------------------------------------------
 * Controls how the upstream Prisma packages + Rust engines are renamed
 * and republished under your own npm scope (e.g. `@vertexa/*`) and
 * GitHub Release host (e.g. `lh0x00/prisma`).
 *
 * Override at runtime via env vars (or CLI flags on each script):
 *   FORK_SCOPE              e.g. "@vertexa" (default)
 *   FORK_VERSION            e.g. "7.8.0" (REQUIRED)
 *   FORK_TAG                e.g. "latest" | "next" | "fork" (default "latest")
 *   FORK_DRY_RUN            "true" to skip the actual publish/upload step
 *   FORK_GH_REPO            e.g. "lh0x00/prisma" (default)
 *   FORK_ENGINE_TARGETS     comma-list of platform slugs to build, default 3
 *   FORK_ENGINES_COMMIT     override the commit hash baked into engines-version
 */

export const FORK_SCOPE = process.env.FORK_SCOPE ?? '@vertexa'
export const FORK_GH_REPO = process.env.FORK_GH_REPO ?? 'lh0x00/prisma'

/**
 * Workspace packages we fully rebrand + publish from `packages/<dir>`.
 *
 * Order matters: this is the topological publish order.
 * Each package only depends on packages declared *before* it.
 */
export type ForkPackage = {
  upstreamName: string
  dir: string
  forkSlug: string
}

export const FORK_PACKAGES: ForkPackage[] = [
  { upstreamName: '@prisma/debug', dir: 'debug', forkSlug: 'prisma-debug' },
  {
    upstreamName: '@prisma/driver-adapter-utils',
    dir: 'driver-adapter-utils',
    forkSlug: 'prisma-driver-adapter-utils',
  },
  { upstreamName: '@prisma/adapter-pg', dir: 'adapter-pg', forkSlug: 'prisma-adapter-pg' },
  { upstreamName: '@prisma/get-platform', dir: 'get-platform', forkSlug: 'prisma-get-platform' },
  // Stub workspace package that becomes our forked `@prisma/engines-version`.
  // See `packages/engines-version-fork/`. Must come before fetch-engine + engines.
  {
    upstreamName: '@prisma/engines-version-fork',
    dir: 'engines-version-fork',
    forkSlug: 'prisma-engines-version',
  },
  { upstreamName: '@prisma/fetch-engine', dir: 'fetch-engine', forkSlug: 'prisma-fetch-engine' },
  { upstreamName: '@prisma/engines', dir: 'engines', forkSlug: 'prisma-engines' },
  { upstreamName: '@prisma/config', dir: 'config', forkSlug: 'prisma-config' },
  {
    upstreamName: '@prisma/client-runtime-utils',
    dir: 'client-runtime-utils',
    forkSlug: 'prisma-client-runtime-utils',
  },
  { upstreamName: '@prisma/client', dir: 'client', forkSlug: 'prisma-client' },
  { upstreamName: 'prisma', dir: 'cli', forkSlug: 'prisma' },
]

/**
 * Pure rename map (no local source to rebuild). Used when our forked
 * packages depend transitively on `@prisma/engines-version` from the
 * upstream npm registry — we want those deps to point at our forked
 * `@<scope>/prisma-engines-version` published from `engines-version-fork/`.
 */
export const RENAME_ONLY: Array<{ upstreamName: string; forkSlug: string }> = [
  // The published name from the workspace stub above is the same string,
  // so any upstream `@prisma/engines-version` dep gets rewritten too.
  { upstreamName: '@prisma/engines-version', forkSlug: 'prisma-engines-version' },
]

/**
 * Rust crates inside `prisma-engines/` that compile to npm-publishable
 * WASM packages. Built with `wasm-pack build` (or the local `build.sh`
 * convention). The `pkg/` output directory is what gets published.
 */
export type WasmCrate = {
  /**
   * Path under `prisma-engines/` where the wasm-pack output lands.
   *
   * Different upstream make targets write to different locations:
   *   - `build-schema-wasm` writes to `target/prisma-schema-wasm/` (using
   *     the Cargo target dir convention, *not* a `pkg/` subdir).
   *   - `build-se-wasm` writes to `schema-engine/schema-engine-wasm/pkg/`.
   *   - `build-qc-wasm` writes to `query-compiler/query-compiler-wasm/pkg/`.
   *
   * We store the literal "where to read the built npm package from" path
   * here so both `publish-wasm.ts` and `patch-source.ts#injectLocalWasmDeps`
   * can point consumers at the right directory without guessing.
   */
  pkgDir: string
  /** Original npm name as it appears upstream. */
  upstreamName: string
  /** Forked slug appended after `${FORK_SCOPE}/`. */
  forkSlug: string
  /** `make` target inside `prisma-engines/Makefile`, if any (informational). */
  makeTarget?: string
}

export const WASM_CRATES: WasmCrate[] = [
  {
    pkgDir: 'target/prisma-schema-wasm',
    upstreamName: '@prisma/prisma-schema-wasm',
    forkSlug: 'prisma-schema-wasm',
    makeTarget: 'build-schema-wasm',
  },
  {
    pkgDir: 'schema-engine/schema-engine-wasm/pkg',
    upstreamName: '@prisma/schema-engine-wasm',
    forkSlug: 'prisma-schema-engine-wasm',
    makeTarget: 'build-se-wasm',
  },
  {
    pkgDir: 'query-compiler/query-compiler-wasm/pkg',
    upstreamName: '@prisma/query-compiler-wasm',
    forkSlug: 'prisma-query-compiler-wasm',
    makeTarget: 'build-qc-wasm',
  },
]

/**
 * Workspace `package.json` files that depend on the upstream npm-published
 * versions of our WASM crates. Before `pnpm fork:build` runs we repoint each
 * of these to `file:../../prisma-engines/<cratePath>/<pkgPath>` so the built
 * bundles ship the *forked* WASM (with e.g. PostGIS / Geometry schema support)
 * instead of whatever upstream version was in the lockfile.
 *
 * Each entry lists which crates a given consumer pulls in; the patch-source
 * step skips an entry when the corresponding crate hasn't been wasm-pack-built
 * yet, so partial WASM builds remain valid.
 */
export type WasmInjection = {
  /** Path under `packages/`, e.g. `internals`. */
  consumerDir: string
  /** Upstream WASM packages this consumer depends on. Subset of WASM_CRATES.upstreamName. */
  upstreamDeps: string[]
}

export const WASM_LOCAL_INJECTIONS: WasmInjection[] = [
  {
    consumerDir: 'internals',
    upstreamDeps: ['@prisma/prisma-schema-wasm', '@prisma/schema-engine-wasm'],
  },
  {
    consumerDir: 'client',
    upstreamDeps: ['@prisma/query-compiler-wasm'],
  },
  {
    consumerDir: 'schema-files-loader',
    upstreamDeps: ['@prisma/prisma-schema-wasm'],
  },
  {
    consumerDir: 'get-dmmf',
    upstreamDeps: ['@prisma/prisma-schema-wasm'],
  },
]

/**
 * Native engine binaries the fork ships. Currently Prisma 7 only requires
 * one native engine (`schema-engine`); query work has migrated to
 * `query-compiler-wasm`.
 */
export const NATIVE_ENGINES = ['schema-engine'] as const
export type NativeEngine = (typeof NATIVE_ENGINES)[number]

/**
 * Platform targets we build native engines for by default.
 * Each entry maps to the binary-target slug used by `@prisma/get-platform`
 * (see `packages/fetch-engine/__tests__/download.test.ts` for the full list).
 *
 * Builders:
 *   - `host`   = `cargo build` directly on the developer machine
 *                (typically only works for the matching platform).
 *   - `docker` = build inside a Linux container described in
 *                `scripts/fork/engines/Dockerfile.<targetSlug>`.
 */
export type EngineTarget = {
  slug: string
  builder: 'host' | 'docker'
  /** Rust target triple for `cargo --target=...`. */
  rustTarget: string
  /**
   * Optional Docker platform string (e.g. `linux/amd64`, `linux/arm64`).
   * Forwarded to `docker build --platform` and `docker run --platform`.
   *
   * Required when the platform-slug describes an arch different from the
   * host's: e.g. `debian-openssl-3.0.x` is x86_64 glibc, so on Apple
   * Silicon we must force `linux/amd64` (Docker emulates via Rosetta).
   * Without it, the Rust toolchain inside the image only carries the
   * host's arch target and `cargo --target x86_64-unknown-linux-gnu`
   * fails with "can't find crate for `core`".
   */
  dockerPlatform?: string
}

export const DEFAULT_ENGINE_TARGETS: EngineTarget[] = [
  { slug: 'darwin-arm64', builder: 'host', rustTarget: 'aarch64-apple-darwin' },
  {
    slug: 'debian-openssl-3.0.x',
    builder: 'docker',
    rustTarget: 'x86_64-unknown-linux-gnu',
    dockerPlatform: 'linux/amd64',
  },
  {
    slug: 'linux-musl-openssl-3.0.x',
    builder: 'docker',
    rustTarget: 'x86_64-unknown-linux-musl',
    dockerPlatform: 'linux/amd64',
  },
]

/** Lookup user override `FORK_ENGINE_TARGETS=slug1,slug2,...`. */
export function resolveEngineTargets(): EngineTarget[] {
  const raw = process.env.FORK_ENGINE_TARGETS
  if (!raw) return DEFAULT_ENGINE_TARGETS
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return DEFAULT_ENGINE_TARGETS.filter((t) => wanted.includes(t.slug))
}

/**
 * Build the upstream → forked name map.
 * Used both for `package.json` deps rewriting and for textual replacements
 * in build output (`require("@prisma/client/runtime/library")` etc.).
 *
 * Includes both `FORK_PACKAGES`, `RENAME_ONLY`, and `WASM_CRATES`.
 */
export function buildNameMap(scope = FORK_SCOPE): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of FORK_PACKAGES) {
    map.set(p.upstreamName, `${scope}/${p.forkSlug}`)
  }
  for (const p of RENAME_ONLY) {
    map.set(p.upstreamName, `${scope}/${p.forkSlug}`)
  }
  for (const c of WASM_CRATES) {
    map.set(c.upstreamName, `${scope}/${c.forkSlug}`)
  }
  return map
}

/** File globs (relative to a package dir) whose text content gets rewritten. */
export const REWRITE_GLOBS = [
  'package.json',
  'README.md',
  // Standard build output dirs
  'build/**/*',
  'dist/**/*',
  'runtime/**/*',
  'generator-build/**/*',
  'prisma-client/**/*',
  'install/**/*',
  'preinstall/**/*',
  'download/**/*',
  'scripts/**/*',
  // wasm-pack output
  'pkg/**/*',
]

/** File extensions safe for text replacement (no binaries). */
export const REWRITE_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.json',
  '.map',
  '.md',
  '.txt',
  '.html',
])

/**
 * Resolve the commit hash that the forked `@<scope>/prisma-engines-version`
 * package will advertise. Order of precedence:
 *   1. `FORK_ENGINES_COMMIT` env var (CI override).
 *   2. `git -C prisma-engines rev-parse HEAD`.
 */
export async function resolveEnginesCommitHash(repoRoot: string): Promise<string> {
  const override = process.env.FORK_ENGINES_COMMIT
  if (override) return override.trim()

  const { execaCommand } = await import('execa')
  const { stdout } = await execaCommand('git rev-parse HEAD', {
    cwd: `${repoRoot}/prisma-engines`,
    shell: true,
  })
  return stdout.trim()
}

/** GitHub Release tag we upload native engines to. */
export function releaseTagFor(commit: string): string {
  return `engines-${commit}`
}

/** Single asset filename inside a Release. */
export function releaseAssetName(target: string, engine: string): string {
  // Flat layout — GitHub Releases do not support nested folders.
  return `${target}__${engine}.gz`
}

/** sha256 sidecar filename inside a Release. */
export function releaseChecksumName(target: string, engine: string): string {
  return `${releaseAssetName(target, engine)}.sha256`
}
