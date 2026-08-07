import 'dotenv/config'

import { defineConfig, env } from '@vertexa/prisma-config'

// `prisma db push` + `prisma generate` read this. The runtime in src/index.ts
// uses the same env var via the @prisma/adapter-pg connection string.
export default defineConfig({
  datasource: {
    url: env('POSTGIS_URL'),
  },
})
