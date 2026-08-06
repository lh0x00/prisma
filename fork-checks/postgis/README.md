# `@vertexa/prisma` PostGIS smoke test

Tiny standalone project to verify the **published** `@vertexa/*@7.8.0` fork
exposes the new geometry/PostGIS surface end-to-end against a real Postgres
+ PostGIS instance.

## What gets checked

`src/index.ts` runs each check sequentially (every check truncates the tables
first) and prints `PASS` / `FAIL`:

- Point / LineString / Polygon round-trip (including a Polygon with a hole)
- `near` filter — `ST_DWithin` over the `geography` projection
- `within` filter — `ST_Within` against an inline polygon
- `intersects` filter — `ST_Intersects` against inline GeoJSON
- `distanceFrom` orderBy, both `asc` and `desc` — `ST_Distance`
- Combined `where + orderBy + take + select`
- `NOT` filter excluding a geo match
- `null` geometry round-trip
- Custom SRID 3857 (Web Mercator) storage + filter
- `$queryRawUnsafe` with `ST_AsText(ST_GeomFromText(...))`
- `$queryRaw` returning a typed `Prisma.Geometry` column

## Dependencies

The rebrand pipeline publishes 11 packages including
`@vertexa/prisma-adapter-pg` and `@vertexa/prisma-driver-adapter-utils`,
which ship the runtime bits that auto-detect PostGIS OIDs
(`geometry` / `geography` → GeoJSON objects).

`package.json` pulls them straight from npm:

```jsonc
"@vertexa/prisma-adapter-pg": "7.8.0",
"@vertexa/prisma-driver-adapter-utils": "7.8.0",
"pnpm": {
  "overrides": {
    "@prisma/debug": "npm:@vertexa/prisma-debug@7.8.0"
  }
}
```

## Setup

1. Copy the env file:

   ```bash
   cp .env.example .env
   ```

2. Start Postgres + PostGIS via the bundled docker compose:

   ```bash
   pnpm db:up
   # wait ~5–10s for the healthcheck to pass
   ```

   `docker/postgis-test.yml` runs `postgis/postgis:15-3.3` on port `5433`
   with the `postgis` extension preinstalled in the default `tests` DB.

3. Install dependencies (outside the parent repo's pnpm workspace):

   ```bash
   pnpm install --ignore-workspace
   ```

## Run

```bash
pnpm generate    # runs `@vertexa/prisma generate` from schema.prisma
pnpm db:push     # pushes the schema (already passes --force-reset)
pnpm check       # runs tsx src/index.ts
```

Or in one shot end-to-end:

```bash
pnpm all
```

Expected output (one line per check, summary at the bottom):

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
