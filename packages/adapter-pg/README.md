# @vertexa/prisma-adapter-pg

Fork of [`@prisma/adapter-pg`](https://github.com/prisma/prisma) with **PostGIS OID detection**.

Driver adapter for Prisma ORM that enables usage of the [`node-postgres`](https://node-postgres.com/) (`pg`) database driver for PostgreSQL — same as upstream, plus automatic detection of PostGIS `geometry` / `geography` column OIDs so they are returned as typed GeoJSON objects instead of raw bytes.

[Why this fork exists](https://lh0x00.dev/p/vertexa-prisma-postgis-fork)

## Install

```bash
npm install @vertexa/prisma-adapter-pg
```

## Usage

```typescript
import { PrismaPg } from '@vertexa/prisma-adapter-pg'
import { PrismaClient } from '@vertexa/prisma-client'
import { Pool } from 'pg'

const adapter = new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL }))
const prisma = new PrismaClient({ adapter })
```

## What's different from upstream?

The fork patches the adapter to recognize PostGIS OIDs (`geometry`, `geography`) and decode the EWKB bytes returned by `pg` into GeoJSON objects that Prisma Client can work with directly. Without this, PostGIS columns come back as opaque `Buffer` values.

This adapter is required for PostGIS features (`near`, `within`, `intersects`, `distanceFrom`) to work with `@vertexa/prisma-client`.

## License

Apache-2.0
