# @vertexa/prisma

Fork of [Prisma ORM](https://github.com/prisma/prisma) with **PostGIS / Geometry support** for PostgreSQL.

## What is this?

This is a rebranded fork of Prisma ORM v7.8, published under the `@vertexa` npm scope. The fork adds native PostGIS support — schema-level `Geometry` / `Geography` scalar types, query filters (`near`, `within`, `intersects`), and GeoJSON ↔ EWKB serialization — on top of the standard Prisma feature set.

Everything else works the same as upstream Prisma. If you know Prisma, you know this fork.

[Why this fork exists](https://lh0x00.dev/p/vertexa-prisma-postgis-fork)

## Install

```bash
npm install @vertexa/prisma @vertexa/prisma-client
```

With pnpm, add an override so internal deps resolve to the fork:

```jsonc
{
  "pnpm": {
    "overrides": {
      "@prisma/debug": "npm:@vertexa/prisma-debug@7.8.5",
    },
  },
}
```

## Usage

```bash
npx @vertexa/prisma generate
npx @vertexa/prisma db push
npx @vertexa/prisma migrate dev
```

### PostGIS schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Location {
  id       Int        @id @default(autoincrement())
  name     String
  position Geography? @db.Geography(Point, 4326)
}

model Area {
  id       Int       @id @default(autoincrement())
  name     String
  boundary Geometry? @db.Geometry(Polygon, 4326)
}
```

### PostGIS queries

```typescript
import { PrismaClient } from '@vertexa/prisma-client'
import { PrismaPg } from '@vertexa/prisma-adapter-pg'
import { Pool } from 'pg'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })

// near → ST_DWithin
await prisma.location.findMany({
  where: { position: { near: { point: [2.35, 48.85], distance: 1000 } } },
})

// intersects → ST_Intersects
await prisma.area.findMany({
  where: {
    boundary: {
      intersects: {
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 1],
              [1, 3],
              [3, 3],
              [3, 1],
              [1, 1],
            ],
          ],
        },
      },
    },
  },
})

// orderBy distanceFrom → ST_Distance
await prisma.location.findMany({ orderBy: { position: { distanceFrom: [2.35, 48.85] } } })
```

## PostGIS features

| Feature                      | SQL             | Schema type                |
| ---------------------------- | --------------- | -------------------------- |
| `near` filter                | `ST_DWithin`    | `Geography`                |
| `within` filter              | `ST_Within`     | `Geometry`                 |
| `intersects` filter          | `ST_Intersects` | `Geometry`                 |
| `distanceFrom` orderBy       | `ST_Distance`   | `Geography` / `Geometry`   |
| GeoJSON ↔ EWKB round-trip   | —               | `Geometry` / `Geography`   |
| Multi-SRID (4326, 3857, ...) | —               | `@db.Geometry(type, srid)` |

## Packages

This CLI is part of a fork that publishes these packages under `@vertexa/*`:

| Package                                | Replaces                       |
| -------------------------------------- | ------------------------------ |
| `@vertexa/prisma`                      | `prisma`                       |
| `@vertexa/prisma-client`               | `@prisma/client`               |
| `@vertexa/prisma-adapter-pg`           | `@prisma/adapter-pg`           |
| `@vertexa/prisma-config`               | `@prisma/config`               |
| `@vertexa/prisma-driver-adapter-utils` | `@prisma/driver-adapter-utils` |
| `@vertexa/prisma-debug`                | `@prisma/debug`                |
| `@vertexa/prisma-engines`              | `@prisma/engines`              |
| `@vertexa/prisma-engines-version`      | `@prisma/engines-version`      |
| `@vertexa/prisma-fetch-engine`         | `@prisma/fetch-engine`         |
| `@vertexa/prisma-get-platform`         | `@prisma/get-platform`         |
| `@vertexa/prisma-client-runtime-utils` | `@prisma/client-runtime-utils` |
| `@vertexa/prisma-query-compiler-wasm`  | `@prisma/query-compiler-wasm`  |
| `@vertexa/prisma-schema-engine-wasm`   | `@prisma/schema-engine-wasm`   |
| `@vertexa/prisma-prisma-schema-wasm`   | `@prisma/prisma-schema-wasm`   |

## License

Apache-2.0
