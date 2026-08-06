/**
 * Post-build rewrite of every package listed in `FORK_PACKAGES`.
 *
 * IMPORTANT: this script must run AFTER `pnpm build`. Anything that
 * affects the build output (e.g. patching `fetch-engine/src/utils.ts`)
 * lives in `patch-source.ts` and runs BEFORE the build instead. Doing
 * it the other way around breaks Turborepo's task graph because we
 * delete `devDependencies` here.
 *
 * Per package:
 *   1. Patch its `package.json`:
 *        - rename `name`              -> `${FORK_SCOPE}/${forkSlug}`
 *        - bump  `version`            -> `FORK_VERSION`
 *        - rename matching keys in `dependencies`/`peerDependencies`/
 *          `optionalDependencies`/`peerDependenciesMeta`
 *        - replace `workspace:*` ranges with `^FORK_VERSION`
 *        - drop `devDependencies` entirely (consumers don't need them and
 *          they often contain unresolvable `workspace:*` for packages we
 *          deliberately do not publish)
 *        - drop `prepublishOnly`/`prepare`/`prepack`/`postpublish` so
 *          `npm publish` does not try to rebuild after rewriting
 *        - ensure `publishConfig.access = "public"`
 *   2. Walk every text file shipped with the package (see `REWRITE_GLOBS`)
 *      and replace upstream package-name string literals with their forked
 *      counterparts so generated output (e.g. `require('@prisma/client/...')`)
 *      points at the fork.
 *
 * Idempotent: re-running over an already-rebranded tree is a no-op for
 * the `name` field (we recognise both the upstream and the forked name).
 *
 * Run `pnpm fork:restore` afterwards to undo all changes.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import arg from 'arg'
import globby from 'globby'
import { bold, cyan, dim, green, red, yellow } from 'kleur/colors'

import { buildNameMap, FORK_PACKAGES, FORK_SCOPE, REWRITE_EXTENSIONS, REWRITE_GLOBS } from './fork.config'

type CliArgs = {
  '--version'?: string
  '--scope'?: string
  '--dry-run'?: boolean
}

const args = arg(
  {
    '--version': String,
    '--scope': String,
    '--dry-run': Boolean,
  } as const,
  { permissive: false },
) as CliArgs

const DRY_RUN = args['--dry-run'] || process.env.FORK_DRY_RUN === 'true'
const SCOPE = args['--scope'] || FORK_SCOPE
const VERSION = args['--version'] || process.env.FORK_VERSION || ''

if (!VERSION) {
  console.error(red(`Missing fork version. Pass --version <semver> or set FORK_VERSION.`))
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+(?:-[\w.+-]+)?$/.test(VERSION)) {
  console.error(red(`Invalid semver "${VERSION}". Expected e.g. 7.8.0`))
  process.exit(1)
}

const NAME_MAP = buildNameMap(SCOPE)

// Inverse map: forked name -> upstream name. Used so re-running rebrand
// over an already-renamed package.json is a no-op for the `name` field.
const NAME_MAP_INVERSE = new Map<string, string>()
for (const [u, f] of NAME_MAP) NAME_MAP_INVERSE.set(f, u)

console.log(bold(`\nFork rebrand`))
console.log(`  scope        ${cyan(SCOPE)}`)
console.log(`  version      ${cyan(VERSION)}`)
console.log(`  dry-run      ${cyan(String(!!DRY_RUN))}`)
console.log(`  packages     ${cyan(String(FORK_PACKAGES.length))}`)
console.log()

const repoRoot = path.resolve(__dirname, '..', '..')
const packagesRoot = path.join(repoRoot, 'packages')

type Json = Record<string, unknown>

async function readJson(file: string): Promise<Json> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function writeJson(file: string, data: Json) {
  if (DRY_RUN) return
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n')
}

function rewriteDeps(
  block: Record<string, string> | undefined,
  workspaceVersionMap: Map<string, string>,
): { changed: boolean; out: Record<string, string> | undefined } {
  if (!block) return { changed: false, out: block }
  let changed = false
  const out: Record<string, string> = {}
  for (const [name, range] of Object.entries(block)) {
    const renamedKey = NAME_MAP.get(name) ?? name
    let value = range
    if (NAME_MAP.has(name)) {
      // Renamed dep -> always pin to the same fork version range.
      value = `^${VERSION}`
      changed = true
    } else if (workspaceVersionMap.has(name)) {
      // Workspace dep that we keep, but it would otherwise resolve to
      // `workspace:*` which `npm publish` cannot translate — pin it.
      value = workspaceVersionMap.get(name)!
      changed = true
    } else if (typeof range === 'string' && range.startsWith('workspace:')) {
      // Workspace ref that we have no version for: leave as-is so a later
      // step / `pnpm publish` can resolve. Should not happen for our
      // minimal set, but keep visible so it surfaces on real publish.
      console.warn(yellow(`  ! unresolved workspace ref ${name}@${range}`))
    }
    if (renamedKey !== name) changed = true
    out[renamedKey] = value
  }
  return { changed, out }
}

async function patchPackageJson(pkgDir: string): Promise<{
  before: string
  after: string
}> {
  const file = path.join(pkgDir, 'package.json')
  const json = await readJson(file)

  const currentName = json.name as string
  let forked = NAME_MAP.get(currentName)
  let before = currentName

  if (!forked) {
    // Maybe the package was already rebranded (idempotent re-run). In that
    // case `currentName` is the forked name and we leave it untouched.
    if (NAME_MAP_INVERSE.has(currentName)) {
      forked = currentName
      before = NAME_MAP_INVERSE.get(currentName) as string
    } else {
      throw new Error(`Package ${currentName} (in ${pkgDir}) is not in the fork map`)
    }
  }

  json.name = forked
  json.version = VERSION

  // External deps: only rename keys that are in the fork map.
  // `workspace:*` resolution is handled above.
  const wsVersionMap = new Map<string, string>()
  for (const [, forkedName] of NAME_MAP) {
    wsVersionMap.set(forkedName, `^${VERSION}`)
  }

  // `devDependencies` are not needed by consumers and frequently contain
  // unresolvable `workspace:*` ranges for packages we deliberately do *not*
  // publish (internals, migrate, generator-*, etc., all of which are
  // bundled by esbuild into our published artifacts). Drop them entirely.
  delete json.devDependencies

  for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const block = json[key] as Record<string, string> | undefined
    const { out } = rewriteDeps(block, wsVersionMap)
    if (out) json[key] = out
  }

  // Rename keys inside `peerDependenciesMeta` so they line up with the
  // renamed `peerDependencies`. Values stay as-is.
  const peerMeta = json.peerDependenciesMeta as Record<string, unknown> | undefined
  if (peerMeta) {
    const renamed: Record<string, unknown> = {}
    for (const [name, meta] of Object.entries(peerMeta)) {
      renamed[NAME_MAP.get(name) ?? name] = meta
    }
    json.peerDependenciesMeta = renamed
  }

  // Drop lifecycle scripts that would re-trigger a build during `npm publish`.
  // The repo is already built before `rebrand` runs.
  const scripts = json.scripts as Record<string, string> | undefined
  if (scripts) {
    for (const dangerous of ['prepublishOnly', 'prepare', 'prepack', 'postpublish']) {
      if (dangerous in scripts) {
        delete scripts[dangerous]
      }
    }
  }

  // We always want public access on a scoped package.
  const pubConfig = (json.publishConfig as Record<string, unknown> | undefined) ?? {}
  pubConfig.access = 'public'
  // Keep registry pluggable via npmrc, do not hard-code it here.
  delete pubConfig.registry
  json.publishConfig = pubConfig

  await writeJson(file, json)

  return { before, after: forked }
}

async function rewriteTextFiles(pkgDir: string) {
  const files = await globby(REWRITE_GLOBS, {
    cwd: pkgDir,
    onlyFiles: true,
    dot: false,
    ignore: [
      '**/node_modules/**',
      '**/*.d.ts.map',
      '**/*.tsbuildinfo',
      // `package.json` is rewritten precisely in `patchPackageJson`.
      // Skipping here avoids double-encoding (e.g. `prisma` getting
      // re-matched inside the freshly written `@vertexdb/prisma` value).
      'package.json',
    ],
  })

  // Build one regex per name-shape so we only match at the *right* boundary
  // for each.
  //
  // Scoped names (`@prisma/<foo>`): allow `/` on either side so that nested
  // ESM import paths like `'@prisma/client/runtime/library'` get rewritten
  // to `'@vertexdb/prisma-client/runtime/library'` — the trailing `/runtime/…`
  // is a legitimate package-subpath continuation.
  //
  // Bare names (`prisma`): quote/backtick on BOTH sides, *no* slash. Without
  // this the regex matches the CLI name inside arbitrary filesystem paths
  // and URLs (e.g. `'./prisma/schema.prisma'` → `'./@vertexdb/prisma/schema.prisma'`
  // or `'https://github.com/lh0x00/prisma/releases/...'` →
  // `'https://github.com/lh0x00/@vertexdb/prisma/releases/...'`). Both
  // corruptions break the fork at runtime; quote-only is the conservative
  // boundary that still rewrites every legitimate `require('prisma')` /
  // `import('prisma')` / `"prisma"` package-name reference.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sortedNames = [...NAME_MAP.keys()].sort((a, b) => b.length - a.length)
  const scopedNames = sortedNames.filter((n) => n.startsWith('@'))
  const bareNames = sortedNames.filter((n) => !n.startsWith('@'))

  const patterns: RegExp[] = []
  if (scopedNames.length) {
    patterns.push(new RegExp(`(?<=["'\`/])(?:${scopedNames.map(escapeRe).join('|')})(?=["'\`/])`, 'g'))
  }
  if (bareNames.length) {
    patterns.push(new RegExp(`(?<=["'\`])(?:${bareNames.map(escapeRe).join('|')})(?=["'\`])`, 'g'))
  }

  let totalReplacements = 0
  let touchedFiles = 0

  for (const rel of files) {
    const ext = path.extname(rel)
    if (ext && !REWRITE_EXTENSIONS.has(ext)) continue
    const abs = path.join(pkgDir, rel)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || !stat.isFile()) continue

    let original: string
    try {
      original = await fs.readFile(abs, 'utf8')
    } catch {
      continue
    }
    // Skip binary-looking files that slipped through.
    if (original.includes('\u0000')) continue

    let count = 0
    let next = original
    for (const pattern of patterns) {
      next = next.replace(pattern, (match) => {
        const replacement = NAME_MAP.get(match) ?? match
        if (replacement !== match) count += 1
        return replacement
      })
    }

    if (count > 0) {
      totalReplacements += count
      touchedFiles += 1
      if (!DRY_RUN) await fs.writeFile(abs, next)
    }
  }

  return { totalReplacements, touchedFiles }
}

async function main() {
  // Note: there is no git-clean gate here. The strict gate lives in
  // `patch-source.ts`, which runs first in the pipeline. By the time
  // rebrand runs, `fetch-engine/src/utils.ts` is already legitimately
  // dirty (patched) and the build output dirs we rewrite are untracked.
  // Rebrand itself is idempotent so re-runs are safe.

  for (const pkg of FORK_PACKAGES) {
    const pkgDir = path.join(packagesRoot, pkg.dir)
    const stat = await fs.stat(pkgDir).catch(() => null)
    if (!stat) {
      console.error(red(`  ✗ missing package dir: ${pkgDir}`))
      process.exit(1)
    }
    const { before, after } = await patchPackageJson(pkgDir)
    const stats = await rewriteTextFiles(pkgDir)
    console.log(
      `${green('  ✓')} ${bold(pkg.dir.padEnd(28))} ${dim(before)} → ${cyan(after)}` +
        `  ${dim(`(rewrote ${stats.totalReplacements} refs in ${stats.touchedFiles} files)`)}`,
    )
  }

  if (DRY_RUN) {
    console.log(yellow(`\nDry run — no files written.`))
  } else {
    console.log(green(`\nDone. Run \`pnpm fork:publish\` next, then \`pnpm fork:restore\` to revert.`))
  }
}

main().catch((e) => {
  console.error(red(`rebrand failed: ${(e as Error).stack ?? (e as Error).message}`))
  process.exit(1)
})
