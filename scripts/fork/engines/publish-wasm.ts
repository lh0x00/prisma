/**
 * Rebrand + publish the WASM packages produced by `build-wasm.ts`.
 *
 * For each crate listed in `WASM_CRATES`:
 *   1. Reads `prisma-engines/<cratePath>/<pkgPath>/package.json`
 *   2. Sets `name`     -> `${FORK_SCOPE}/${forkSlug}`
 *      Sets `version`  -> `FORK_VERSION`
 *      Sets `publishConfig.access = "public"` (scoped + free tier require)
 *   3. Runs `npm publish --ignore-scripts --access public --tag <tag>`
 *      (or `--dry-run` if requested).
 *
 * The `pkg/` directories are wasm-pack output and intentionally ignored
 * by git, so we mutate them in place — there is nothing to revert.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import { FORK_SCOPE, WASM_CRATES } from '../fork.config'

type CliArgs = {
  '--tag'?: string
  '--dry-run'?: boolean
  '--otp'?: string
  '--registry'?: string
  '--only'?: string
}

const args = arg(
  {
    '--tag': String,
    '--dry-run': Boolean,
    '--otp': String,
    '--registry': String,
    '--only': String,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'
const TAG = args['--tag'] || process.env.FORK_TAG || 'latest'
const OTP = args['--otp'] || process.env.FORK_OTP
const REGISTRY = args['--registry'] || process.env.FORK_REGISTRY
const VERSION = process.env.FORK_VERSION

if (!VERSION) {
  console.error(red(`Missing FORK_VERSION env var (e.g. 7.8.0)`))
  process.exit(1)
}

const only = (args['--only'] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const crates = WASM_CRATES.filter((c) => only.length === 0 || only.includes(c.forkSlug))

const repoRoot = path.resolve(__dirname, '..', '..', '..')

console.log(bold('\nFork publish-wasm'))
console.log(`  scope        ${cyan(FORK_SCOPE)}`)
console.log(`  version      ${cyan(VERSION)}`)
console.log(`  tag          ${cyan(TAG)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
console.log(`  registry     ${cyan(REGISTRY ?? dim('(default)'))}`)
console.log(`  crates       ${cyan(`${crates.length}/${WASM_CRATES.length}`)}`)
console.log()

async function patchAndPublish(crate: (typeof WASM_CRATES)[number]) {
  const pkgDir = path.join(repoRoot, 'prisma-engines', crate.pkgDir)
  const pkgJsonPath = path.join(pkgDir, 'package.json')

  const stat = await fs.stat(pkgDir).catch(() => null)
  if (!stat) {
    console.warn(yellow(`  ! skipping ${crate.forkSlug}: ${pkgDir} not found (run build-wasm first)`))
    return
  }

  const json = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8')) as Record<string, unknown>
  const before = json.name as string
  const after = `${FORK_SCOPE}/${crate.forkSlug}`

  json.name = after
  json.version = VERSION
  const pubConfig = (json.publishConfig as Record<string, unknown> | undefined) ?? {}
  pubConfig.access = 'public'
  delete pubConfig.registry
  json.publishConfig = pubConfig

  if (!DRY_RUN) await fs.writeFile(pkgJsonPath, JSON.stringify(json, null, 2) + '\n')

  console.log(`${cyan('▶')} ${bold(crate.forkSlug.padEnd(34))} ${dim(`${before} -> ${after}`)}`)

  const flags = ['publish', '--access', 'public', '--tag', TAG, '--ignore-scripts']
  if (DRY_RUN) flags.push('--dry-run')
  if (OTP) flags.push('--otp', OTP)
  if (REGISTRY) flags.push('--registry', REGISTRY)

  const cmd = `npm ${flags.join(' ')}`
  if (DRY_RUN) {
    console.log(`${dim('$')} ${cmd}    ${dim(`(cwd=${pkgDir})`)}`)
    return
  }
  await execaCommand(cmd, { cwd: pkgDir, stdio: 'inherit', shell: true })
  console.log(`${green('  ✓ published')} ${cyan(after)}@${VERSION}`)
}

async function main() {
  for (const crate of crates) {
    await patchAndPublish(crate)
  }
  console.log()
  if (DRY_RUN) {
    console.log(yellow(`Dry run complete — nothing was actually published.`))
  } else {
    console.log(green(`Done.`))
  }
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
