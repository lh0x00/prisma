# @prisma/engines-version-fork

Workspace stub that becomes `@<your-scope>/prisma-engines-version` after
`scripts/fork/rebrand.ts` runs. It mirrors the contract of upstream
`@vertexdb/prisma-engines-version`: a single `enginesVersion` export read from
`package.json#prisma.enginesVersion`.

The forked publish pipeline:

1. Sets `prisma.enginesVersion` to the commit hash of the local
   `prisma-engines/` checkout (or `FORK_ENGINES_COMMIT`).
2. Renames `name` → `@<scope>/prisma-engines-version` and pins `version`
   to `FORK_VERSION`.
3. `npm publish --access public` from this directory.

Do **not** depend on this package directly; depend on
`@vertexdb/prisma-engines-version` upstream and let the rebrand script rewrite the
dep at publish time.
