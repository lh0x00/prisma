/**
 * Publish the rebranded fork packages to npm.
 *
 * Assumes `pnpm fork:rebrand --version <semver>` has already been run, so
 * every package in `FORK_PACKAGES` now carries its forked name + version
 * in its `package.json`, and any `workspace:*` ranges have been pinned.
 *
 * Order matches the topological order declared in `FORK_PACKAGES`.
 *
 * Flags:
 *   --tag <dist-tag>   default `latest`
 *   --dry-run          run `npm publish --dry-run`
 *   --otp <code>       forwarded to npm publish
 *   --registry <url>   forwarded to npm publish
 *   --only <pkg,..>    publish only listed forkSlugs (comma separated)
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import { FORK_PACKAGES, FORK_SCOPE } from './fork.config'

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
const ONLY = (args['--only'] || process.env.FORK_ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const repoRoot = path.resolve(__dirname, '..', '..')
const packagesRoot = path.join(repoRoot, 'packages')

const targets = FORK_PACKAGES.filter((p) => ONLY.length === 0 || ONLY.includes(p.forkSlug))

console.log(bold(`\nFork publish`))
console.log(`  scope        ${cyan(FORK_SCOPE)}`)
console.log(`  tag          ${cyan(TAG)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
console.log(`  registry     ${cyan(REGISTRY ?? dim('(default)'))}`)
console.log(`  packages     ${cyan(`${targets.length}/${FORK_PACKAGES.length}`)}`)
console.log()

async function publishOne(dir: string, forkSlug: string) {
  const cwd = path.join(packagesRoot, dir)
  const flags = [
    'publish',
    '--access',
    'public',
    '--tag',
    TAG,
    // Skip lifecycle scripts to avoid `prepublishOnly`/`preinstall` running
    // during publish (we already built the repo and rebranded outputs).
    '--ignore-scripts',
  ]
  if (DRY_RUN) flags.push('--dry-run')
  if (OTP) flags.push('--otp', OTP)
  if (REGISTRY) flags.push('--registry', REGISTRY)

  const cmd = `npm ${flags.join(' ')}`
  console.log(`${cyan('▶')} ${bold(forkSlug.padEnd(34))} ${dim(cmd)}`)

  try {
    await execaCommand(cmd, { cwd, stdio: 'inherit', shell: true })
    console.log(`${green('  ✓ published')} ${cyan(forkSlug)}`)
  } catch (e) {
    console.error(`${red('  ✗ failed')} ${cyan(forkSlug)}`)
    throw e
  }
}

/**
 * Verify every targeted package's `package.json#name` already starts with
 * `FORK_SCOPE`. If any still carries an upstream `@prisma/...` (or bare
 * `prisma`) name, abort loudly — the caller most likely forgot to run
 * `pnpm fork:rebrand` (or ran `pnpm fork:restore` after rebranding).
 *
 * Without this gate, `npm publish` would happily push the upstream name
 * to npm and fail with a 403 (or worse, an OTP prompt for a name the
 * user doesn't own).
 */
async function ensureRebranded(): Promise<void> {
  const offenders: { dir: string; name: string }[] = []
  for (const pkg of targets) {
    const pkgJsonPath = path.join(packagesRoot, pkg.dir, 'package.json')
    try {
      const json = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8')) as { name?: string }
      const name = json.name ?? ''
      if (!name.startsWith(`${FORK_SCOPE}/`)) {
        offenders.push({ dir: pkg.dir, name })
      }
    } catch (e) {
      offenders.push({ dir: pkg.dir, name: `<unreadable: ${(e as Error).message}>` })
    }
  }

  if (offenders.length === 0) return

  console.error(red(`\nAborting: ${offenders.length} package(s) are not rebranded to ${FORK_SCOPE}/*:\n`))
  for (const { dir, name } of offenders) {
    console.error(`  ${red('✗')} packages/${dir.padEnd(28)} name=${yellow(name)}`)
  }
  console.error(yellow(`\nRun the full pipeline before publishing:`))
  console.error(`  ${dim('FORK_VERSION=<semver>')} pnpm fork:patch-source`)
  console.error(`  ${dim('FORK_VERSION=<semver>')} pnpm fork:build`)
  console.error(`  ${dim('FORK_VERSION=<semver>')} pnpm fork:rebrand`)
  console.error(`  ${dim('FORK_VERSION=<semver>')} pnpm fork:publish`)
  console.error(yellow(`\nOr in one shot: \`FORK_VERSION=<semver> pnpm fork:release:js-only\`.`))
  process.exit(1)
}

async function main() {
  await ensureRebranded()

  for (const pkg of targets) {
    await publishOne(pkg.dir, pkg.forkSlug)
  }

  console.log()
  if (DRY_RUN) {
    console.log(yellow(`Dry run complete — nothing was actually published.`))
  } else {
    console.log(green(`Done. Run \`pnpm fork:restore\` to revert local rebrand changes.`))
  }
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
