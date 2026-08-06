/**
 * Upload `dist-engines/<target>/schema-engine.gz[.sha256]` artifacts to a
 * GitHub Release tagged `engines-<commit-hash>` so that the rebranded
 * `fetch-engine` (see `rebrand.ts`) can download them at
 *
 *   https://github.com/<repo>/releases/download/engines-<hash>/<slug>__schema-engine.gz
 *
 * Requires the `gh` CLI to be installed and authenticated against the
 * target repo (`gh auth status` should show "Logged in to github.com").
 *
 * Flags:
 *   --commit <hash>   override engines-version commit (default: prisma-engines HEAD)
 *   --repo <owner/n>  override target repo (default: FORK_GH_REPO)
 *   --dry-run         print the commands instead of executing them
 *   --draft           create the release as a draft
 *   --prerelease      mark the release as a prerelease
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import {
  DEFAULT_ENGINE_TARGETS,
  FORK_GH_REPO,
  NATIVE_ENGINES,
  releaseTagFor,
  resolveEnginesCommitHash,
  resolveEngineTargets,
} from '../fork.config'

type CliArgs = {
  '--commit'?: string
  '--repo'?: string
  '--dry-run'?: boolean
  '--draft'?: boolean
  '--prerelease'?: boolean
}

const args = arg(
  {
    '--commit': String,
    '--repo': String,
    '--dry-run': Boolean,
    '--draft': Boolean,
    '--prerelease': Boolean,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'
const REPO = args['--repo'] || FORK_GH_REPO

const repoRoot = path.resolve(__dirname, '..', '..', '..')
const distDir = path.join(repoRoot, 'dist-engines')

async function run(cmd: string, cwd = repoRoot) {
  if (DRY_RUN) {
    console.log(`${dim('$')} ${cmd}`)
    return ''
  }
  const { stdout } = await execaCommand(cmd, { cwd, stdio: ['inherit', 'pipe', 'inherit'], shell: true })
  return stdout
}

async function ensureGhCli() {
  try {
    await execaCommand('gh --version', { stdio: 'ignore', shell: true })
  } catch {
    console.error(red('`gh` CLI not found. Install via https://cli.github.com/ and run `gh auth login`.'))
    process.exit(1)
  }
}

async function ensureRelease(tag: string) {
  // Check if a release already exists with this tag.
  try {
    await execaCommand(`gh release view ${tag} --repo ${REPO}`, { stdio: 'ignore', shell: true })
    console.log(`${dim('●')} release ${cyan(tag)} already exists on ${REPO}`)
    return
  } catch {
    // Not found — create it.
  }

  const flags = [
    `--repo ${REPO}`,
    `--title 'Forked Prisma engines (${tag})'`,
    '--notes "Auto-uploaded by scripts/fork/engines/upload-release.ts"',
  ]
  if (args['--draft']) flags.push('--draft')
  if (args['--prerelease']) flags.push('--prerelease')

  await run(`gh release create ${tag} ${flags.join(' ')}`)
  console.log(`${green('  ✓ created release')} ${cyan(tag)}`)
}

async function uploadAssets(tag: string) {
  const targets = resolveEngineTargets()
  let uploaded = 0

  for (const target of targets) {
    for (const engine of NATIVE_ENGINES) {
      const dir = path.join(distDir, target.slug)
      const gz = path.join(dir, `${engine}.gz`)
      const sha = path.join(dir, `${engine}.gz.sha256`)

      const gzExists = await fs.stat(gz).catch(() => null)
      if (!gzExists) {
        console.warn(
          yellow(`  ! skipping ${target.slug}/${engine}.gz: missing (did you run fork:engines:build:native?)`),
        )
        continue
      }

      // Rename on upload to GitHub's flat asset namespace: `<slug>__<engine>.gz`.
      const gzAsset = `${target.slug}__${engine}.gz`
      const shaAsset = `${target.slug}__${engine}.gz.sha256`

      await run(`gh release upload ${tag} '${gz}#${gzAsset}' --clobber --repo ${REPO}`)
      const shaExists = await fs.stat(sha).catch(() => null)
      if (shaExists) {
        await run(`gh release upload ${tag} '${sha}#${shaAsset}' --clobber --repo ${REPO}`)
      }
      console.log(`${green('  ✓ uploaded')} ${cyan(`${tag}/${gzAsset}`)}`)
      uploaded += 1
    }
  }

  return uploaded
}

async function main() {
  // `gh` CLI is only required for real uploads. Dry-runs print the commands
  // and exit cleanly so devs can verify the pipeline without installing it.
  if (!DRY_RUN) await ensureGhCli()

  const commit = args['--commit'] || (await resolveEnginesCommitHash(repoRoot))
  const tag = releaseTagFor(commit)

  console.log(bold('\nFork upload-release'))
  console.log(`  repo         ${cyan(REPO)}`)
  console.log(`  commit       ${cyan(commit)}`)
  console.log(`  tag          ${cyan(tag)}`)
  console.log(
    `  targets      ${cyan(
      resolveEngineTargets()
        .map((t) => t.slug)
        .join(', '),
    )}`,
  )
  console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
  console.log()

  if (resolveEngineTargets().length === 0) {
    console.warn(yellow('No engine targets selected — nothing to upload.'))
    return
  }
  // Sanity reminder.
  if (DEFAULT_ENGINE_TARGETS.length === 0) {
    console.warn(yellow('No default engine targets configured.'))
  }

  await ensureRelease(tag)
  const n = await uploadAssets(tag)

  console.log()
  if (DRY_RUN) {
    console.log(yellow('Dry run complete — nothing was uploaded.'))
  } else {
    console.log(green(`Uploaded ${n} asset(s) to https://github.com/${REPO}/releases/tag/${tag}`))
  }
}

main().catch((e) => {
  console.error(red((e as Error).stack ?? (e as Error).message))
  process.exit(1)
})
