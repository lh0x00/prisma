/**
 * Undo every change made by `rebrand.ts` so the working tree matches HEAD
 * again, even when some of the rebranded paths are untracked (i.e. the
 * forked-only `packages/engines-version-fork/` directory has never been
 * committed to the local fork branch).
 *
 * Behaviour per path:
 *   - tracked + dirty   -> `git restore --source HEAD --staged --worktree -- <path>`
 *   - tracked + clean   -> no-op
 *   - untracked / new   -> reset its `package.json` (name + version + the
 *                          stub `enginesVersion`) to the in-source default
 *                          so the fork stub is reusable on next run.
 *
 * This script is idempotent: running it twice in a row is safe.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import { FORK_PACKAGES, WASM_LOCAL_INJECTIONS } from './fork.config'

const repoRoot = path.resolve(__dirname, '..', '..')
const packagesRoot = path.join(repoRoot, 'packages')

// When the engines-version-fork stub isn't tracked in git, only the
// `enginesVersion` field is reset (it gets stamped fresh by `patch-source.ts`
// on every run anyway). The user is free to keep `name`/`version` set to
// the forked values for local-dev convenience — we don't second-guess them.
const STUB_ENGINES_HASH = '0000000000000000000000000000000000000000'

async function isTracked(p: string): Promise<boolean> {
  try {
    const { stdout } = await execaCommand(`git ls-files --error-unmatch -- '${p}'`, {
      cwd: repoRoot,
      shell: true,
      stdio: ['inherit', 'pipe', 'ignore'],
    })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function gitRestore(p: string): Promise<void> {
  await execaCommand(`git restore --source HEAD --staged --worktree -- '${p}'`, {
    cwd: repoRoot,
    shell: true,
    stdio: 'inherit',
  })
}

async function resetEnginesVersionStub(): Promise<void> {
  const dir = path.join(packagesRoot, 'engines-version-fork')
  const pkgJson = path.join(dir, 'package.json')
  const exists = await fs.stat(pkgJson).catch(() => null)
  if (!exists) return

  const json = JSON.parse(await fs.readFile(pkgJson, 'utf8')) as Record<string, any>
  json.prisma = { ...(json.prisma || {}), enginesVersion: STUB_ENGINES_HASH }
  await fs.writeFile(pkgJson, JSON.stringify(json, null, 2) + '\n')
}

async function main() {
  console.log(bold('\nFork restore'))
  console.log(`  packages     ${cyan(String(FORK_PACKAGES.length))}`)
  console.log()

  for (const pkg of FORK_PACKAGES) {
    const rel = `packages/${pkg.dir}`
    const abs = path.join(repoRoot, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) continue

    const tracked = await isTracked(rel)
    if (tracked) {
      try {
        await gitRestore(rel)
        console.log(`${green('  ✓ restored')} ${dim(rel)}`)
      } catch {
        console.warn(yellow(`  ! git restore failed for ${rel} (continuing)`))
      }
    } else if (pkg.dir === 'engines-version-fork') {
      await resetEnginesVersionStub()
      console.log(`${green('  ✓ reset stub')} ${dim(rel)}`)
    } else {
      console.log(`${dim('  · skipping untracked')} ${rel}`)
    }
  }

  // Also restore the patched fetch-engine source if it was tracked.
  const fetchUtils = 'packages/fetch-engine/src/utils.ts'
  if (await isTracked(fetchUtils)) {
    try {
      await gitRestore(fetchUtils)
      console.log(`${green('  ✓ restored')} ${dim(fetchUtils)}`)
    } catch {
      console.warn(yellow(`  ! git restore failed for ${fetchUtils} (continuing)`))
    }
  }

  // And the WASM-injection consumer manifests (internals, client, …). These
  // are tracked package.json files that `patch-source.ts#injectLocalWasmDeps`
  // rewrites to `file:` deps; without this step the working tree stays dirty
  // after a release and `fork:install` would refuse `--frozen-lockfile`.
  for (const injection of WASM_LOCAL_INJECTIONS) {
    const rel = `packages/${injection.consumerDir}/package.json`
    const abs = path.join(repoRoot, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) continue

    if (await isTracked(rel)) {
      try {
        await gitRestore(rel)
        console.log(`${green('  ✓ restored')} ${dim(rel)}`)
      } catch {
        console.warn(yellow(`  ! git restore failed for ${rel} (continuing)`))
      }
    } else {
      console.log(`${dim('  · skipping untracked')} ${rel}`)
    }
  }

  console.log(green(`\nDone.`))
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
