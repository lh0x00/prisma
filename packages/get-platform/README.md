# @vertexa/prisma-get-platform

Fork of `@prisma/get-platform` — platform detection for Prisma engine binaries.

⚠️ **Internal package** — consumed by `@vertexa/prisma-fetch-engine`. Do not depend on it directly.

## Usage

```ts
import { getBinaryTargetForCurrentPlatform } from '@vertexa/prisma-get-platform'

const binaryTarget = await getBinaryTargetForCurrentPlatform()
```
