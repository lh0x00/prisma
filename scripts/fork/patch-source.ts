/**
 * Pre-build patches.
 *
 * Anything in this file must run BEFORE `pnpm build` so the resulting
 * bundle output already reflects the fork's behaviour. Things that only
 * change `package.json` metadata (name / deps / etc.) belong in
 * `rebrand.ts` and run AFTER the build so they don't interfere with
 * Turborepo's task graph (which uses `dependencies`/`devDependencies`
 * to schedule builds).
 *
 * Currently performs:
 *   1. Patch `packages/fetch-engine/src/utils.ts` so the published code
 *      defaults to a GitHub Release flat-asset URL pattern instead of
 *      `https://binaries.prisma.sh/all_commits/<hash>/<target>/<engine>.gz`.
 *   2. Stamp `packages/engines-version-fork/package.json#prisma.enginesVersion`
 *      with the local `prisma-engines/` HEAD commit (or `FORK_ENGINES_COMMIT`)
 *      so the matching tag (`engines-<hash>`) is the one we will upload to.
 *
 * Both operations are idempotent. Re-running over already-patched files
 * is a no-op (and prints `(already patched)`).
 *
 * Run `pnpm fork:restore` afterwards to revert.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import {
  FORK_GH_REPO,
  releaseTagFor,
  resolveEnginesCommitHash,
  WASM_CRATES,
  WASM_LOCAL_INJECTIONS,
} from './fork.config'

type CliArgs = {
  '--dry-run'?: boolean
  '--check'?: boolean
}

const args = arg(
  {
    '--dry-run': Boolean,
    '--check': Boolean,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'

const repoRoot = path.resolve(__dirname, '..', '..')
const packagesRoot = path.join(repoRoot, 'packages')

console.log(bold('\nFork patch-source'))
console.log(`  repo         ${cyan(FORK_GH_REPO)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)

async function ensureGitClean(): Promise<void> {
  // Mirror `rebrand.ts`: only block on tracked, modified files under
  // `packages/`. Untracked entries (`??`, e.g. the engines-version-fork
  // stub before first commit) are tolerated.
  const { stdout } = await execaCommand('git status --porcelain -- packages', {
    cwd: repoRoot,
    shell: true,
  })
  const blocking = stdout
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('??'))
    .join('\n')
  if (blocking) {
    console.error(red(`\nTracked files under packages/ have uncommitted changes:\n`))
    console.error(blocking)
    console.error(yellow(`\nRun \`pnpm fork:restore\` (or commit/stash), or pass --check to bypass.`))
    process.exit(1)
  }
}

/**
 * Replace the upstream `binaries.prisma.sh` URL template with a flat
 * GitHub Releases layout. Verified against the upstream snippet so a
 * future refactor breaks the build loudly instead of shipping a
 * silently-broken fork.
 */
async function patchFetchEngineSource(enginesCommitHash: string): Promise<void> {
  const file = path.join(packagesRoot, 'fetch-engine', 'src', 'utils.ts')
  const original = await fs.readFile(file, 'utf8')

  const forkBaseUrl = `https://github.com/${FORK_GH_REPO}/releases/download/${releaseTagFor(enginesCommitHash)}`

  const upstreamDefault = `'https://binaries.prisma.sh'`
  const forkedDefault = `'${forkBaseUrl}'`
  const upstreamPattern = '`${baseUrl}/${channel}/${version}/${binaryTarget}/${binaryName}${finalExtension}`'
  const forkedPattern = '`${baseUrl}/${binaryTarget}__${binaryName}${finalExtension}`'

  const alreadyPatched = original.includes(forkedDefault) || !original.includes(upstreamDefault)
  if (alreadyPatched) {
    console.log(`${dim('  ·')} fetch-engine src ${dim('(already patched)')}`)
    return
  }
  if (!original.includes(upstreamPattern)) {
    throw new Error(
      `fetch-engine/src/utils.ts is missing the upstream URL template. Update scripts/fork/patch-source.ts.`,
    )
  }

  const next = original.replace(upstreamDefault, forkedDefault).replace(upstreamPattern, forkedPattern)

  if (DRY_RUN) {
    console.log(`${green('  ✓')} fetch-engine src patch ${dim('(dry-run)')}  ${dim('default -> ' + forkBaseUrl)}`)
  } else {
    await fs.writeFile(file, next)
    console.log(`${green('  ✓')} fetch-engine src patch  ${dim('default -> ' + forkBaseUrl)}`)
  }
}

/**
 * Stamp `engines-version-fork/package.json#prisma.enginesVersion` with
 * the local prisma-engines commit hash. Anything else in that file
 * (name, version, etc.) is intentionally left alone — the user may have
 * pre-renamed the stub for local-dev convenience and we should respect it.
 */
async function stampEnginesVersionStub(enginesCommitHash: string): Promise<void> {
  const file = path.join(packagesRoot, 'engines-version-fork', 'package.json')
  const exists = await fs.stat(file).catch(() => null)
  if (!exists) {
    console.warn(yellow(`  ! engines-version-fork/package.json missing, skipping stamp`))
    return
  }

  const json = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>
  const prisma = (json.prisma as Record<string, unknown> | undefined) ?? {}
  const current = String(prisma.enginesVersion ?? '')

  if (current === enginesCommitHash) {
    console.log(`${dim('  ·')} engines-version stub ${dim('(already stamped)')}`)
    return
  }

  prisma.enginesVersion = enginesCommitHash
  json.prisma = prisma

  if (DRY_RUN) {
    console.log(
      `${green('  ✓')} engines-version stub ${dim('(dry-run)')}  ${dim(
        `enginesVersion: ${current || '(empty)'} -> ${enginesCommitHash}`,
      )}`,
    )
  } else {
    await fs.writeFile(file, JSON.stringify(json, null, 2) + '\n')
    console.log(
      `${green('  ✓')} engines-version stub  ${dim(`enginesVersion: ${current || '(empty)'} -> ${enginesCommitHash}`)}`,
    )
  }
}

/**
 * Repoint each consumer in `WASM_LOCAL_INJECTIONS` so its dependency on the
 * upstream npm `@prisma/<crate>` becomes `file:../../prisma-engines/<crate>/pkg`,
 * making the next `pnpm install` + `pnpm fork:build` bundle the *forked* WASM.
 *
 * Idempotent: a dep already pointing at the local pkg is left alone.
 *
 * Each missing `pkg/` directory is skipped with a warning — that just means
 * `pnpm fork:engines:build:wasm` hasn't run yet for that crate, so the
 * consumer keeps depending on the upstream npm version (a fine fallback that
 * just won't include the fork's PSL changes for that crate).
 */
async function injectLocalWasmDeps(): Promise<void> {
  const cratesByUpstream = new Map(WASM_CRATES.map((c) => [c.upstreamName, c]))

  for (const injection of WASM_LOCAL_INJECTIONS) {
    const pkgJsonPath = path.join(packagesRoot, injection.consumerDir, 'package.json')
    const exists = await fs.stat(pkgJsonPath).catch(() => null)
    if (!exists) {
      console.warn(yellow(`  ! ${injection.consumerDir}: package.json missing, skipping`))
      continue
    }

    const json = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8')) as Record<string, any>

    type UpdateLoc = { block: 'dependencies' | 'devDependencies'; name: string; from: string; to: string }
    const updates: UpdateLoc[] = []
    const skipped: string[] = []

    for (const upstreamName of injection.upstreamDeps) {
      const crate = cratesByUpstream.get(upstreamName)
      if (!crate) {
        console.warn(yellow(`  ! unknown WASM upstream dep ${upstreamName} for ${injection.consumerDir}`))
        continue
      }

      // Locate the dep across `dependencies` / `devDependencies`. `packages/client`
      // for instance keeps `@prisma/query-compiler-wasm` in `devDependencies`
      // because esbuild bundles it at build time. We must repoint it wherever
      // it actually sits — otherwise the upstream version still wins.
      const candidateBlocks: Array<'dependencies' | 'devDependencies'> = ['dependencies', 'devDependencies']
      let targetBlock: 'dependencies' | 'devDependencies' | null = null
      let existing: string | undefined
      for (const blockName of candidateBlocks) {
        const block = json[blockName] as Record<string, string> | undefined
        if (block && upstreamName in block) {
          targetBlock = blockName
          existing = block[upstreamName]
          break
        }
      }

      // Relative path from `packages/<consumer>/` to the wasm-pack output dir.
      const cratePkgAbs = path.join(repoRoot, 'prisma-engines', crate.pkgDir)
      const cratePkgRel = path.relative(path.dirname(pkgJsonPath), cratePkgAbs)
      const fileDep = `file:${cratePkgRel}`

      if (existing === fileDep) {
        skipped.push(`${upstreamName} (already injected)`)
        continue
      }

      if (!targetBlock) {
        // The consumer declares no dep at all on this crate. Skip rather than
        // synthesise one — that would expand the dependency surface unexpectedly.
        skipped.push(`${upstreamName} (not declared in dependencies/devDependencies)`)
        continue
      }

      const cratePkgStat = await fs.stat(cratePkgAbs).catch(() => null)
      if (!cratePkgStat) {
        skipped.push(`${upstreamName} (pkg/ missing — run fork:engines:build:wasm)`)
        continue
      }

      json[targetBlock][upstreamName] = fileDep
      updates.push({ block: targetBlock, name: upstreamName, from: existing ?? '(missing)', to: fileDep })
    }

    if (updates.length === 0) {
      if (skipped.length > 0) {
        console.log(`${dim('  ·')} ${injection.consumerDir} ${dim(`(${skipped.join(', ')})`)}`)
      }
      continue
    }

    if (DRY_RUN) {
      for (const u of updates) {
        console.log(
          `${green('  ✓')} ${injection.consumerDir} ${dim('(dry-run)')}  ${dim(
            `${u.block}.${u.name}: ${u.from} -> ${u.to}`,
          )}`,
        )
      }
    } else {
      await fs.writeFile(pkgJsonPath, JSON.stringify(json, null, 2) + '\n')
      for (const u of updates) {
        console.log(`${green('  ✓')} ${injection.consumerDir}  ${dim(`${u.block}.${u.name}: ${u.from} -> ${u.to}`)}`)
      }
    }
    if (skipped.length > 0) {
      console.log(`${dim('  ·')} ${injection.consumerDir} ${dim(`(${skipped.join(', ')})`)}`)
    }
  }
}

async function main() {
  if (!args['--check'] && !DRY_RUN) await ensureGitClean()

  const enginesCommitHash = await resolveEnginesCommitHash(repoRoot)
  console.log(`  enginesHash  ${cyan(enginesCommitHash)}`)
  console.log()

  await patchFetchEngineSource(enginesCommitHash)
  await stampEnginesVersionStub(enginesCommitHash)
  await injectLocalWasmDeps()

  if (DRY_RUN) {
    console.log(yellow(`\nDry run — no files written.`))
  } else {
    console.log(
      green(
        `\nDone. Run \`pnpm install --frozen-lockfile=false\` (so the new file: deps resolve), ` +
          `then \`pnpm fork:build\` before \`pnpm fork:rebrand\`.`,
      ),
    )
  }
}

main().catch((e) => {
  console.error(red(`patch-source failed: ${(e as Error).stack ?? (e as Error).message}`))
  process.exit(1)
})
