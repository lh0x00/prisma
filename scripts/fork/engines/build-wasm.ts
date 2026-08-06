/**
 * Build the WASM crates inside `prisma-engines/` so they can be published
 * as forked npm packages.
 *
 * Drives the existing upstream Makefile targets:
 *   - `build-schema-wasm`  (prisma-schema-wasm)
 *   - `build-se-wasm`      (schema-engine/schema-engine-wasm)
 *   - `build-qc-wasm`      (query-compiler/query-compiler-wasm)
 *
 * Builders:
 *   - `host`   : runs `make` directly on the developer machine. Requires
 *                a stable Rust toolchain + wasm32 target + wasm-bindgen-cli
 *                + binaryen (`wasm-opt`) + jq + protoc.
 *   - `docker` : default. Uses `Dockerfile.wasm-builder` so we don't have
 *                to pollute the host with the toolchain.
 *
 * Output stays inside `prisma-engines/<crate>/pkg/` per upstream convention.
 * `publish-wasm.ts` then rebrands + publishes those `pkg/` directories.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import { WASM_CRATES } from '../fork.config'

type CliArgs = {
  '--builder'?: string
  '--profile'?: string
  '--no-cache'?: boolean
  '--dry-run'?: boolean
  '--only'?: string
}

const args = arg(
  {
    '--builder': String,
    '--profile': String,
    '--no-cache': Boolean,
    '--dry-run': Boolean,
    '--only': String,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'
const BUILDER = (args['--builder'] || process.env.FORK_WASM_BUILDER || 'docker') as 'host' | 'docker'
const PROFILE = args['--profile'] || process.env.WASM_BUILD_PROFILE || 'release'
const VERSION = process.env.FORK_VERSION || '0.0.0'

if (BUILDER !== 'host' && BUILDER !== 'docker') {
  console.error(red(`--builder must be 'host' or 'docker' (got: ${BUILDER})`))
  process.exit(1)
}

const only = (args['--only'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const crates = WASM_CRATES.filter((c) => only.length === 0 || only.includes(c.forkSlug))

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const enginesSrc = path.join(repoRoot, 'prisma-engines')
const dockerCtx = path.join(repoRoot, 'scripts', 'fork', 'engines')

console.log(bold('\nFork build-wasm'))
console.log(`  builder      ${cyan(BUILDER)}`)
console.log(`  profile      ${cyan(PROFILE)}`)
console.log(`  version      ${cyan(VERSION)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
console.log(`  crates       ${cyan(crates.map((c) => c.forkSlug).join(', '))}`)
console.log()

async function run(cmd: string, cwd: string, env: Record<string, string> = {}) {
  if (DRY_RUN) {
    const envStr = Object.keys(env).length
      ? `${Object.entries(env)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')} `
      : ''
    console.log(`${dim('$')} ${envStr}${cmd}    ${dim(`(cwd=${cwd})`)}`)
    return
  }
  await execaCommand(cmd, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  })
}

async function buildHost() {
  // The Makefile drives the per-crate `build.sh` scripts. We pass a single
  // version so all three packages get the same `version` field.
  const env = {
    WASM_BUILD_PROFILE: PROFILE,
    SCHEMA_ENGINE_WASM_VERSION: VERSION,
    QE_WASM_VERSION: VERSION,
    SCHEMA_WASM_VERSION: VERSION,
  }

  // Build only the targets selected via `--only`, falling back to all three.
  const targets = crates.map((c) => c.makeTarget).filter((t): t is string => Boolean(t))

  if (targets.length === 0) {
    console.warn(yellow('No make targets selected.'))
    return
  }

  await run(`make ${targets.join(' ')}`, enginesSrc, env)
}

/**
 * Read the `wasm-bindgen` crate version pinned in `prisma-engines/Cargo.lock`.
 * The CLI version we install in the builder image MUST match this exactly,
 * otherwise wasm-bindgen aborts with a "schema version" mismatch error.
 */
async function readWasmBindgenVersion(): Promise<string> {
  const lockfile = path.join(enginesSrc, 'Cargo.lock')
  const content = await fs.readFile(lockfile, 'utf8')
  // Match `name = "wasm-bindgen"` (the crate, not -macro / -shared / etc.)
  // followed by `version = "x.y.z"` on the next line.
  const re = /\[\[package\]\][^[]*?name = "wasm-bindgen"\s*\nversion = "([^"]+)"/
  const m = content.match(re)
  if (!m) {
    throw new Error(`Could not locate wasm-bindgen version in ${lockfile}`)
  }
  return m[1]
}

async function buildDocker() {
  const tag = 'vertexdb/prisma-builder:wasm'
  const noCache = args['--no-cache'] ? ' --no-cache' : ''
  const wasmBindgenVersion = await readWasmBindgenVersion()
  console.log(`  wasm-bindgen ${cyan(wasmBindgenVersion)} ${dim('(from prisma-engines/Cargo.lock)')}`)

  await run(
    `docker build${noCache}` +
      ` --build-arg WASM_BINDGEN_VERSION=${wasmBindgenVersion}` +
      ` -f '${path.join(dockerCtx, 'Dockerfile.wasm-builder')}'` +
      ` -t '${tag}' '${dockerCtx}'`,
    repoRoot,
  )

  const targets = crates.map((c) => c.makeTarget).filter((t): t is string => Boolean(t))
  if (targets.length === 0) {
    console.warn(yellow('No make targets selected.'))
    return
  }

  const cargoCache = `${process.env.HOME}/.cargo/registry`
  const envFlags = [
    `-e WASM_BUILD_PROFILE=${PROFILE}`,
    `-e SCHEMA_ENGINE_WASM_VERSION=${VERSION}`,
    `-e QE_WASM_VERSION=${VERSION}`,
    `-e SCHEMA_WASM_VERSION=${VERSION}`,
  ].join(' ')

  const cmd = [
    'docker run --rm',
    `-v '${enginesSrc}:/src'`,
    `-v '${cargoCache}:/root/.cargo/registry'`,
    envFlags,
    `'${tag}'`,
    `"make -C /src ${targets.join(' ')}"`,
  ].join(' ')

  await run(cmd, repoRoot)
}

async function main() {
  if (BUILDER === 'host') await buildHost()
  else await buildDocker()
  console.log(green(`\nDone. wasm-pack output is in prisma-engines/<crate>/pkg/`))
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
