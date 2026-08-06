/**
 * Build the native `schema-engine` Rust binary for every platform target
 * declared in `DEFAULT_ENGINE_TARGETS` (or `FORK_ENGINE_TARGETS`).
 *
 * Output layout (relative to repo root):
 *
 *   dist-engines/
 *     <target-slug>/
 *       schema-engine               (raw binary, kept for inspection)
 *       schema-engine.gz            (artifact uploaded to GitHub Releases)
 *       schema-engine.gz.sha256     (sidecar checksum)
 *
 * Builders:
 *   - `host`   : `cargo build --release --target <triple>` directly. Only
 *                works for the matching platform of the current machine
 *                (e.g. macOS arm64 host -> darwin-arm64).
 *   - `docker` : builds + runs `Dockerfile.<slug>` from
 *                `scripts/fork/engines/`, bind-mounts `prisma-engines/`
 *                into the container, and writes outputs to `dist-engines/`.
 *
 * Flags:
 *   --skip <slug,..>  do not build the listed targets
 *   --only <slug,..>  only build the listed targets
 *   --no-cache        rebuild Docker images from scratch
 *   --dry-run         print the commands that would run, do not exec
 */

import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red } from 'kleur/colors'

import { EngineTarget, NATIVE_ENGINES, resolveEngineTargets } from '../fork.config'

type CliArgs = {
  '--skip'?: string
  '--only'?: string
  '--no-cache'?: boolean
  '--dry-run'?: boolean
}

const args = arg(
  {
    '--skip': String,
    '--only': String,
    '--no-cache': Boolean,
    '--dry-run': Boolean,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'
const skip = (args['--skip'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const only = (args['--only'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const enginesSrc = path.join(repoRoot, 'prisma-engines')
const outDir = path.join(repoRoot, 'dist-engines')
const dockerCtx = path.join(repoRoot, 'scripts', 'fork', 'engines')

let targets = resolveEngineTargets()
if (only.length) targets = targets.filter((t) => only.includes(t.slug))
if (skip.length) targets = targets.filter((t) => !skip.includes(t.slug))

console.log(bold('\nFork build-native'))
console.log(`  outDir       ${cyan(outDir)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
console.log(`  targets      ${cyan(targets.map((t) => `${t.slug}(${t.builder})`).join(', ') || '(none)')}`)
if (targets.length === 0) {
  console.log(red('No targets selected — check --only/--skip and FORK_ENGINE_TARGETS.'))
  process.exit(1)
}
console.log()

async function run(cmd: string, cwd: string) {
  if (DRY_RUN) {
    console.log(`${dim('$')} ${cmd}    ${dim(`(cwd=${cwd})`)}`)
    return
  }
  await execaCommand(cmd, { cwd, stdio: 'inherit', shell: true })
}

async function buildHost(target: { slug: string; rustTarget: string }) {
  // Make sure rustup has the relevant target (no-op if already installed).
  await run(`rustup target add ${target.rustTarget}`, enginesSrc)
  await run(`cargo build --release --target ${target.rustTarget} -p schema-engine-cli`, enginesSrc)

  const slugDir = path.join(outDir, target.slug)
  for (const engine of NATIVE_ENGINES) {
    const built = path.join(enginesSrc, 'target', target.rustTarget, 'release', engine)
    await run(`mkdir -p '${slugDir}'`, repoRoot)
    await run(`install -m0755 '${built}' '${path.join(slugDir, engine)}'`, repoRoot)
    await run(`gzip -fk '${path.join(slugDir, engine)}'`, repoRoot)
    await run(
      `( cd '${slugDir}' && shasum -a 256 '${engine}.gz' | awk '{print $1"  "$2}' > '${engine}.gz.sha256' )`,
      repoRoot,
    )
  }
}

async function buildDocker(target: EngineTarget) {
  const dockerfile = path.join(dockerCtx, `Dockerfile.${target.slug}`)
  const tag = `vertex/prisma-builder:${target.slug}`
  const noCache = args['--no-cache'] ? ' --no-cache' : ''
  // `--platform` must be passed identically to both `build` and `run` so the
  // image is pulled/built for the desired arch and the runtime container
  // emulates it (Rosetta on Apple Silicon, QEMU elsewhere). Without this,
  // Apple Silicon ends up with an arm64 image whose Rust toolchain lacks
  // the requested x86_64 target — see comment on `EngineTarget.dockerPlatform`.
  const platformFlag = target.dockerPlatform ? ` --platform=${target.dockerPlatform}` : ''

  await run(`docker build${noCache}${platformFlag} -f '${dockerfile}' -t '${tag}' '${dockerCtx}'`, repoRoot)

  // Bind-mount source + output dirs. Cargo registry cache speeds up reruns
  // dramatically; ${HOME}/.cargo/registry is the conventional location.
  const cargoCache = `${process.env.HOME}/.cargo/registry`
  const cmd = [
    'docker run --rm',
    platformFlag.trim(),
    `-v '${enginesSrc}:/src'`,
    `-v '${outDir}:/out'`,
    `-v '${cargoCache}:/root/.cargo/registry'`,
    `-e TARGET_SLUG=${target.slug}`,
    `-e CARGO_TARGET=${target.rustTarget}`,
    `'${tag}'`,
  ]
    .filter(Boolean)
    .join(' ')

  await run(cmd, repoRoot)
}

async function main() {
  await run(`mkdir -p '${outDir}'`, repoRoot)

  for (const target of targets) {
    console.log(`\n${cyan('▶')} ${bold(target.slug.padEnd(34))} ${dim(`builder=${target.builder}`)}`)
    try {
      if (target.builder === 'host') await buildHost(target)
      else await buildDocker(target)
      console.log(`${green('  ✓ built')} ${cyan(target.slug)}`)
    } catch (e) {
      console.error(`${red('  ✗ failed')} ${cyan(target.slug)}`)
      throw e
    }
  }

  console.log(green(`\nDone. Output in ${outDir}/`))
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
