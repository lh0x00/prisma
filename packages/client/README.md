# @vertexa/prisma-client

Fork of [Prisma Client](https://github.com/prisma/prisma) with **PostGIS / Geometry support**.

Auto-generated, type-safe query builder for Node.js and TypeScript — same as upstream `@prisma/client`, plus native PostGIS geometry types and spatial query filters.

## Install

```bash
npm install @vertexa/prisma-client @vertexa/prisma
```

## Usage

```typescript
import { PrismaClient } from '@vertexa/prisma-client'
import { PrismaPg } from '@vertexa/prisma-adapter-pg'
import { Pool } from 'pg'

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
})
```

### PostGIS

The fork adds two scalar types and spatial filters not available in upstream Prisma:

```prisma
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

```typescript
// Insert GeoJSON
await prisma.location.create({
  data: { name: 'Paris', position: { type: 'Point', coordinates: [2.35, 48.85], srid: 4326 } },
})

// near → ST_DWithin (distance in meters, requires Geography)
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

// within → ST_Within
await prisma.location.findMany({
  where: {
    position: {
      within: {
        polygon: [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      },
    },
  },
})

// orderBy distanceFrom → ST_Distance
await prisma.location.findMany({ orderBy: { position: { distanceFrom: [2.35, 48.85] } } })
```

## PostGIS features

| Feature                                 | SQL             | Type                       |
| --------------------------------------- | --------------- | -------------------------- |
| `near` filter                           | `ST_DWithin`    | `Geography`                |
| `within` filter                         | `ST_Within`     | `Geometry`                 |
| `intersects` filter                     | `ST_Intersects` | `Geometry`                 |
| `distanceFrom` orderBy                  | `ST_Distance`   | `Geography` / `Geometry`   |
| GeoJSON ↔ EWKB round-trip              | —               | `Geometry` / `Geography`   |
| Multi-SRID (4326, 3857, ...)            | —               | `@db.Geometry(type, srid)` |
| `$queryRaw` returning `Prisma.Geometry` | —               | `Geometry`                 |

## Compatibility

Drop-in replacement for `@prisma/client`. All standard Prisma features (relations, transactions, middleware, extensions, etc.) work identically.

Requires `@vertexa/prisma-adapter-pg` for PostGIS OID detection (converts `geometry` / `geography` columns to GeoJSON objects).

## License

Apache-2.0
