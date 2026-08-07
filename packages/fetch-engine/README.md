# @vertexa/prisma-fetch-engine

Fork of `@prisma/fetch-engine` — downloads and caches Prisma Rust engine binaries.

⚠️ **Internal package** — consumed by `@vertexa/prisma-engines`. Do not depend on it directly.

The fork patches the default download URL to point at the fork's GitHub Releases
(`github.com/lh0x00/prisma/releases/download/engines-<hash>`) instead of
`binaries.prisma.sh`. Users can still override via `PRISMA_ENGINES_MIRROR`.
