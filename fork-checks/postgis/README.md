# @vertexa/prisma — PostGIS smoke test

Standalone project verifying the **published** `@vertexa/*@7.8.5` fork exposes
PostGIS / Geometry features end-to-end against a real Postgres + PostGIS instance.

## What gets checked

`src/index.ts` runs 14 checks sequentially (tables are truncated between each)
and prints `PASS` / `FAIL`:

| #   | Check                                                    | SQL function    |
| --- | -------------------------------------------------------- | --------------- |
| 1   | Point round-trip (insert → findUnique → update)          | —               |
| 2   | LineString round-trip                                    | —               |
| 3   | Polygon with hole (interior ring)                        | —               |
| 4   | `near` filter returns only Paris                         | `ST_DWithin`    |
| 5   | `within` filter selects centroids inside a square        | `ST_Within`     |
| 6   | `intersects` filter against inline GeoJSON polygon       | `ST_Intersects` |
| 7   | `distanceFrom` orderBy ascending                         | `ST_Distance`   |
| 8   | `distanceFrom` orderBy descending                        | `ST_Distance`   |
| 9   | Combined `where + orderBy + take + select`               | —               |
| 10  | `NOT` filter excludes geo matches                        | —               |
| 11  | `null` geometry round-trip                               | —               |
| 12  | SRID 3857 (Web Mercator) storage + `near` filter         | `ST_DWithin`    |
| 13  | `$queryRawUnsafe` with `ST_AsText(ST_GeomFromText(...))` | —               |
| 14  | `$queryRaw` returning typed `Prisma.Geometry` column     | —               |

## Setup

```bash
cp .env.example .env          # POSTGIS_URL=localhost:5433
pnpm db:up                    # docker compose: postgis/postgis:15-3.3 on :5433
pnpm install --ignore-workspace
```

## Run

```bash
pnpm all        # install + db:up + generate + db:push + check
# or step-by-step:
pnpm generate   # @vertexa/prisma generate
pnpm db:push    # prisma db push --force-reset --skip-generate
pnpm check      # tsx src/index.ts
```

Expected output:

```
PostGIS detected: v3.3.x

  PASS  Point round-trip (insert → findUnique → update)
  PASS  LineString round-trip
  ...
  PASS  $queryRaw returns typed Prisma.Geometry column

14 passed, 0 failed (14 total)
```

## Cleanup

```bash
pnpm db:down
rm -rf node_modules generated
```
