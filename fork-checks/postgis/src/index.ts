/**
 * Smoke test for the @vertexdb/prisma-client fork's PostGIS / Geometry features.
 *
 * What this exercises (each block prints PASS/FAIL with a tiny detail):
 *   - Round-trip serialization for Point / LineString / Polygon (GeoJSON ↔ EWKB).
 *   - `near` filter            -> ST_DWithin in geography projection.
 *   - `within` filter          -> ST_Within against an inline polygon.
 *   - `intersects` filter      -> ST_Intersects against an inline GeoJSON geometry.
 *   - `distanceFrom` orderBy   -> ST_Distance ascending / descending.
 *   - Combined where + orderBy + take.
 *   - NULL geometry handling and orderBy-with-nulls behaviour.
 *   - Multi-SRID storage (4326 vs 3857).
 *   - Raw SQL (`$queryRawUnsafe` with `ST_AsText(ST_GeomFromText(...))`) confirms PostGIS is reachable.
 *   - `$queryRaw` returning a `Prisma.Geometry` typed column directly.
 *
 * Connection: reads `POSTGIS_URL` from .env (matches `prisma.config.ts`).
 * Adapter: `@vertexdb/prisma-adapter-pg` – needed for the geometry OID
 *   detection that turns server bytes into the typed GeoJSON object exposed to JS.
 */

import 'dotenv/config'
import { PrismaPg } from '@vertexdb/prisma-adapter-pg'
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { Prisma, PrismaClient } from '../generated/prisma/client'

type Check = { name: string; run: (prisma: PrismaClient) => Promise<void> }

const checks: Check[] = [
  {
    name: 'Point round-trip (insert → findUnique → update)',
    run: async (prisma) => {
      const created = await prisma.location.create({
        data: { name: 'Berlin', position: { type: 'Point', coordinates: [13.4, 52.5], srid: 4326 } },
      })
      assertDeepEqual(created.position, { type: 'Point', coordinates: [13.4, 52.5], srid: 4326 })

      const found = await prisma.location.findUnique({ where: { id: created.id } })
      assertDeepEqual(found?.position, { type: 'Point', coordinates: [13.4, 52.5], srid: 4326 })

      const updated = await prisma.location.update({
        where: { id: created.id },
        data: { position: { type: 'Point', coordinates: [2.35, 48.85], srid: 4326 } },
      })
      assertDeepEqual(updated.position, { type: 'Point', coordinates: [2.35, 48.85], srid: 4326 })
    },
  },
  {
    name: 'LineString round-trip',
    run: async (prisma) => {
      const created = await prisma.route.create({
        data: {
          name: 'RouteA',
          path: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]], srid: 4326 },
        },
      })
      const found = await prisma.route.findUnique({ where: { id: created.id } })
      assertEqual(found?.path?.type, 'LineString')
      assertEqual(found?.path?.coordinates.length, 3)
    },
  },
  {
    name: 'Polygon with hole (interior ring)',
    run: async (prisma) => {
      const polygon: Prisma.InputGeometry = {
        type: 'Polygon',
        coordinates: [
          [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
          [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
        ],
        srid: 4326,
      }
      const created = await prisma.area.create({ data: { name: 'Donut', boundary: polygon } })
      assertEqual(created.boundary?.coordinates.length, 2)
      assertEqual(created.boundary?.coordinates[1].length, 5)
    },
  },
  {
    name: 'near filter (ST_DWithin) returns only Paris',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'Berlin', position: { type: 'Point', coordinates: [13.4, 52.5], srid: 4326 } },
          { name: 'Paris', position: { type: 'Point', coordinates: [2.35, 48.85], srid: 4326 } },
          { name: 'London', position: { type: 'Point', coordinates: [-0.12, 51.5], srid: 4326 } },
        ],
      })
      const nearParis = await prisma.location.findMany({
        where: { position: { near: { point: [2.35, 48.85], maxDistance: 100000 } } },
      })
      assertEqual(nearParis.length, 1)
      assertEqual(nearParis[0].name, 'Paris')
    },
  },
  {
    name: 'within filter (ST_Within) selects centroids inside a square',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'Center', position: { type: 'Point', coordinates: [0.5, 0.5], srid: 4326 } },
          { name: 'Outside', position: { type: 'Point', coordinates: [5, 5], srid: 4326 } },
        ],
      })
      const within = await prisma.location.findMany({
        where: {
          position: {
            within: {
              polygon: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
            },
          },
        },
      })
      assertEqual(within.length, 1)
      assertEqual(within[0].name, 'Center')
    },
  },
  {
    name: 'intersects filter (ST_Intersects) against inline GeoJSON polygon',
    run: async (prisma) => {
      await prisma.area.create({
        data: {
          name: 'TestArea',
          boundary: {
            type: 'Polygon',
            coordinates: [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]],
            srid: 4326,
          },
        },
      })
      const overlapping = await prisma.area.findMany({
        where: {
          boundary: {
            intersects: {
              geometry: {
                type: 'Polygon',
                coordinates: [[[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]]],
              },
            },
          },
        },
      })
      assertEqual(overlapping.length, 1)
      assertEqual(overlapping[0].name, 'TestArea')
    },
  },
  {
    name: 'orderBy distanceFrom (ST_Distance asc)',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'A', position: { type: 'Point', coordinates: [0, 0], srid: 4326 } },
          { name: 'B', position: { type: 'Point', coordinates: [1, 1], srid: 4326 } },
          { name: 'C', position: { type: 'Point', coordinates: [0.1, 0.1], srid: 4326 } },
        ],
      })
      const sorted = await prisma.location.findMany({
        orderBy: { position: { distanceFrom: { point: [0, 0], direction: 'asc' } } },
      })
      assertEqual(sorted.map((r) => r.name).join(','), 'A,C,B')
    },
  },
  {
    name: 'orderBy distanceFrom desc',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'Close', position: { type: 'Point', coordinates: [0.1, 0.1], srid: 4326 } },
          { name: 'Mid', position: { type: 'Point', coordinates: [5, 5], srid: 4326 } },
          { name: 'Far', position: { type: 'Point', coordinates: [10, 10], srid: 4326 } },
        ],
      })
      const sorted = await prisma.location.findMany({
        orderBy: { position: { distanceFrom: { point: [0, 0], direction: 'desc' } } },
      })
      assertEqual(sorted.map((r) => r.name).join(','), 'Far,Mid,Close')
    },
  },
  {
    name: 'where + orderBy + take + select (combined query)',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'A', position: { type: 'Point', coordinates: [0.1, 0.1], srid: 4326 } },
          { name: 'B', position: { type: 'Point', coordinates: [0.2, 0.2], srid: 4326 } },
          { name: 'C', position: { type: 'Point', coordinates: [0.3, 0.3], srid: 4326 } },
          { name: 'Far', position: { type: 'Point', coordinates: [50, 50], srid: 4326 } },
        ],
      })
      const results = await prisma.location.findMany({
        where: { position: { near: { point: [0, 0], maxDistance: 100000 } } },
        orderBy: { position: { distanceFrom: { point: [0, 0], direction: 'asc' } } },
        select: { name: true },
        take: 2,
      })
      assertEqual(results.length, 2)
      assertEqual(results.map((r) => r.name).join(','), 'A,B')
    },
  },
  {
    name: 'NOT filter excludes geo matches',
    run: async (prisma) => {
      await prisma.location.createMany({
        data: [
          { name: 'Close', position: { type: 'Point', coordinates: [0.01, 0.01], srid: 4326 } },
          { name: 'Far', position: { type: 'Point', coordinates: [10, 10], srid: 4326 } },
        ],
      })
      const notNear = await prisma.location.findMany({
        where: { NOT: { position: { near: { point: [0, 0], maxDistance: 10000 } } } },
      })
      assertEqual(notNear.length, 1)
      assertEqual(notNear[0].name, 'Far')
    },
  },
  {
    name: 'null geometry round-trip',
    run: async (prisma) => {
      const created = await prisma.location.create({ data: { name: 'NoLocation', position: null } })
      assertEqual(created.position, null)
      const found = await prisma.location.findUnique({ where: { id: created.id } })
      assertEqual(found?.position, null)
    },
  },
  {
    name: 'SRID 3857 custom-projection round-trip + near',
    run: async (prisma) => {
      await prisma.locationMercator.createMany({
        data: [
          { name: 'P1', position: { type: 'Point', coordinates: [1000000, 6000000], srid: 3857 } },
          { name: 'P2', position: { type: 'Point', coordinates: [1001000, 6000000], srid: 3857 } },
          { name: 'P3', position: { type: 'Point', coordinates: [1100000, 6000000], srid: 3857 } },
        ],
      })
      const near = await prisma.locationMercator.findMany({
        where: { position: { near: { point: [1000000, 6000000], maxDistance: 5000, srid: 3857 } } },
      })
      const names = near.map((r) => r.name).sort().join(',')
      assertEqual(names, 'P1,P2')
    },
  },
  {
    name: '$queryRawUnsafe with ST_AsText(ST_GeomFromText(...))',
    run: async (prisma) => {
      const result = await prisma.$queryRawUnsafe<Array<{ st_astext: string }>>(
        `SELECT ST_AsText(ST_GeomFromText('POINT(13.4 52.5)', 4326)) AS st_astext`,
      )
      assertEqual(result[0].st_astext, 'POINT(13.4 52.5)')
    },
  },
  {
    name: '$queryRaw returns typed Prisma.Geometry column',
    run: async (prisma) => {
      const created = await prisma.location.create({
        data: { name: 'RawTest', position: { type: 'Point', coordinates: [1, 2], srid: 4326 } },
      })
      const result = await prisma.$queryRaw<Array<{ position: Prisma.Geometry | null }>>`
        SELECT position FROM "Location" WHERE id = ${created.id}
      `
      assertDeepEqual(result[0].position, { type: 'Point', coordinates: [1, 2], srid: 4326 })
    },
  },
]

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    throw new Error(`expected ${b} got ${a}`)
  }
}

async function resetTables(prisma: PrismaClient): Promise<void> {
  // Order matters only if FK constraints exist – here all four are independent.
  await prisma.location.deleteMany({})
  await prisma.locationMercator.deleteMany({})
  await prisma.route.deleteMany({})
  await prisma.area.deleteMany({})
}

async function main(): Promise<void> {
  const connectionString = process.env.POSTGIS_URL
  if (!connectionString) {
    throw new Error('POSTGIS_URL is not set – copy .env.example to .env or `pnpm db:up` first')
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  // Confirm the PostGIS extension is present – without it the geometry columns
  // pushed by `prisma db push` will not exist and every subsequent assertion fails.
  const ext = await prisma.$queryRawUnsafe<Array<{ installed: string | null }>>(
    `SELECT extversion AS installed FROM pg_extension WHERE extname = 'postgis'`,
  )
  if (ext.length === 0 || !ext[0].installed) {
    throw new Error(
      'PostGIS extension is not installed in the target database. ' +
        'Use the bundled docker compose (`pnpm db:up`) or `CREATE EXTENSION postgis;` manually.',
    )
  }
  console.log(`PostGIS detected: v${ext[0].installed}\n`)

  let passed = 0
  let failed = 0

  for (const check of checks) {
    try {
      await resetTables(prisma)
      await check.run(prisma)
      console.log(`  PASS  ${check.name}`)
      passed += 1
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  FAIL  ${check.name}`)
      console.log(`        ${message}`)
    }
  }

  await prisma.$disconnect()

  console.log(`\n${passed} passed, ${failed} failed (${checks.length} total)`)
  if (failed > 0) process.exit(1)
}

void main().catch((err) => {
  console.error(err)
  process.exit(1)
})
