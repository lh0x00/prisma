# @vertexa/prisma-engines

Fork of `@prisma/engines` — downloads Prisma engine binaries (schema-engine) from GitHub Releases.

⚠️ **Internal package** — consumed by `@vertexa/prisma` CLI. Do not depend on it directly.

The postinstall hook downloads the schema-engine binary for the current platform.
The download URL points to `github.com/lh0x00/prisma/releases` (fork's GitHub Releases)
instead of `binaries.prisma.sh`.
