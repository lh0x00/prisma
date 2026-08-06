# Forked Prisma — Publishing Guide

Quy trình end-to-end để publish bản fork repo này lên npm dưới scope
`@vertexa/*` (hoặc bất kỳ scope nào bạn cấu hình), bao gồm cả **Rust engines**
(host trên GitHub Releases) và 3 **WASM packages**, sao cho người dùng chỉ cần
`npm i @vertexa/prisma @vertexa/prisma-client` là dùng được code + engine
của nhánh hiện tại không cần config thêm.

> **Phạm vi**: scripts ở `scripts/fork/` rebrand 11 packages JS tối thiểu +
> publish 3 WASM packages từ `prisma-engines/` + build & upload `schema-engine`
> native cho 3 platforms phổ biến (`darwin-arm64`, `debian-openssl-3.0.x`,
> `linux-musl-openssl-3.0.x`). Mọi package khác (`@prisma/internals`,
> `@prisma/migrate`, `@prisma/client-generator-*`, `@prisma/dmmf`, …) đã
> được esbuild bundle vào CLI/Client tại build-time, không cần publish riêng.

## Mapping tên gốc → tên fork

### JS packages (rebrand + publish từ `packages/`)

| Folder dưới `packages/` | Tên gốc                               | Tên fork                              |
| ----------------------- | ------------------------------------- | ------------------------------------- |
| `debug`                 | `@prisma/debug`                       | `@vertexa/prisma-debug`                |
| `driver-adapter-utils`  | `@prisma/driver-adapter-utils`        | `@vertexa/prisma-driver-adapter-utils` |
| `adapter-pg`            | `@prisma/adapter-pg`                  | `@vertexa/prisma-adapter-pg`           |
| `get-platform`          | `@prisma/get-platform`                | `@vertexa/prisma-get-platform`         |
| `engines-version-fork`  | `@prisma/engines-version-fork` (stub) | `@vertexa/prisma-engines-version`      |
| `fetch-engine`          | `@prisma/fetch-engine`                | `@vertexa/prisma-fetch-engine`         |
| `engines`               | `@prisma/engines`                     | `@vertexa/prisma-engines`              |
| `config`                | `@prisma/config`                      | `@vertexa/prisma-config`               |
| `client-runtime-utils`  | `@prisma/client-runtime-utils`        | `@vertexa/prisma-client-runtime-utils` |
| `client`                | `@prisma/client`                      | `@vertexa/prisma-client`               |
| `cli`                   | `prisma`                              | `@vertexa/prisma`                      |

`packages/engines-version-fork/` là **stub mới** trong fork. `rebrand.ts` sẽ
gán `prisma.enginesVersion` = commit hash của `prisma-engines/` HEAD (hoặc
`FORK_ENGINES_COMMIT`) trước khi publish. Mọi dep `@prisma/engines-version`
trong các package khác được tự động đổi sang `@vertexa/prisma-engines-version`.

> **First-time setup**: commit thư mục `packages/engines-version-fork/` vào
> nhánh fork của bạn (`git add packages/engines-version-fork && git commit`)
> để `git restore` có baseline. Sau đó các lần rebrand tiếp theo sẽ được
> revert sạch bởi `pnpm fork:restore`.

### WASM packages (build từ `prisma-engines/`, publish từ `<crate>/pkg/`)

| Cargo crate                          | Tên gốc                       | Tên fork                             |
| ------------------------------------ | ----------------------------- | ------------------------------------ |
| `prisma-schema-wasm`                 | `@prisma/prisma-schema-wasm`  | `@vertexa/prisma-schema-wasm`         |
| `schema-engine/schema-engine-wasm`   | `@prisma/schema-engine-wasm`  | `@vertexa/prisma-schema-engine-wasm`  |
| `query-compiler/query-compiler-wasm` | `@prisma/query-compiler-wasm` | `@vertexa/prisma-query-compiler-wasm` |

### Native engine binaries (build → host trên GitHub Releases)

Chỉ còn 1 binary native cần fork: **`schema-engine`** (Prisma 7 đã chuyển
query work sang `query-compiler-wasm`). Default build 3 platforms:

| Slug                       | Builder                                        | Rust target                 |
| -------------------------- | ---------------------------------------------- | --------------------------- |
| `darwin-arm64`             | host (Mac M-series)                            | `aarch64-apple-darwin`      |
| `debian-openssl-3.0.x`     | Docker (`Dockerfile.debian-openssl-3.0.x`)     | `x86_64-unknown-linux-gnu`  |
| `linux-musl-openssl-3.0.x` | Docker (`Dockerfile.linux-musl-openssl-3.0.x`) | `x86_64-unknown-linux-musl` |

Asset đẩy lên GitHub Release dưới tag `engines-<commit-hash>` với tên flat
`<slug>__schema-engine.gz` + `<slug>__schema-engine.gz.sha256`.

`rebrand.ts` patch `packages/fetch-engine/src/utils.ts` để default URL trỏ
về `https://github.com/<repo>/releases/download/engines-<hash>` với pattern
`${baseUrl}/${binaryTarget}__${binaryName}${ext}`. User vẫn override được
qua `PRISMA_ENGINES_MIRROR`.

Mapping này được khai báo trong `scripts/fork/fork.config.ts` — đổi `FORK_SCOPE`
qua env var để dùng scope khác (ví dụ `FORK_SCOPE=@acme`).

## Yêu cầu trước khi publish

- `npm login --scope=@vertexa` (hoặc `NPM_TOKEN` qua `~/.npmrc`).
- Node `^20.19 || ^22.12 || >=24.0`, pnpm `>=10.15 <11`.
- Docker daemon đang chạy (cho 2 platform Linux).
- `gh` CLI: `brew install gh && gh auth login` — auth được vào `lh0x00/prisma`.
- Disk trống ~5 GB (Rust target dirs + node_modules + Docker images).
- Working tree dưới `packages/` clean (tránh mất sửa đổi local).
- 1 lần đầu: `git add packages/engines-version-fork && git commit` để có baseline.

## Cách dùng

### Cách nhanh nhất — 1 lệnh end-to-end (full fork: JS + WASM + native)

```bash
FORK_VERSION=7.8.0 pnpm fork:release
```

Pipeline (theo đúng thứ tự):

1. `fork:install` → `pnpm install`
2. `fork:patch-source` → **pre-build** patches: rewrite `fetch-engine/src/utils.ts` (default URL → GitHub Release flat-asset) + stamp `engines-version-fork/package.json#prisma.enginesVersion` từ `prisma-engines/` HEAD
3. `fork:build` → `pnpm build` (turbo build với patches đã apply, devDeps chain còn nguyên)
4. `fork:rebrand` → **post-build** rebrand: rename `name` của 9 packages, rewrite bundle output, drop `devDependencies`, drop dangerous lifecycle scripts
5. `fork:engines:build:wasm` → Docker build 3 WASM crates (5 providers × 2 modes cho query-compiler)
6. `fork:engines:build:native` → build `schema-engine` cho 3 platforms (host + Docker)
7. `fork:engines:upload` → `gh release upload` lên tag `engines-<hash>`
8. `fork:engines:publish:wasm` → rename + `npm publish` 3 WASM packages
9. `fork:publish` → `npm publish --ignore-scripts` 9 JS packages theo topo
10. `fork:restore` → revert mọi thay đổi local (git restore tracked + reset stub `enginesVersion`)

> **Tại sao tách `patch-source` ↔ `rebrand`**: Nếu `rebrand` chạy trước build, nó sẽ xóa `devDependencies` của `@vertexa/prisma-client`, làm Turborepo mất signal về dep chain `client → internals → get-dmmf` (chain qua devDeps). Hệ quả: turbo schedule song song → race condition, build fail với `Could not resolve "@prisma/get-dmmf"`. Vì vậy `rebrand` phải chạy SAU build.

### Dry-run (an toàn — không động vào npm/Docker/GitHub)

```bash
FORK_VERSION=7.8.0 pnpm fork:release:dry
```

Mọi `npm publish`, `docker build`, `docker run`, `gh release upload` đều
được in ra console nhưng không thực thi.

### Chỉ JS layer (không fork engines, dùng CDN Prisma upstream)

```bash
FORK_VERSION=7.8.0 pnpm fork:release:js-only
```

Bỏ qua bước build/upload engines + WASM publish. User cài fork sẽ tải Rust
binaries từ `binaries.prisma.sh` của Prisma upstream (lưu ý: muốn vậy phải
**không** chạy `fork:rebrand` patch fetch-engine — xem note ở dưới).

### Chạy từng bước

```bash
# 0. Cài deps (1 lần)
pnpm install

# 1. Pre-build source patches (fetch-engine URL + engines-version stub)
FORK_VERSION=7.8.0 pnpm fork:patch-source

# 2. Build JS bundles (turbo) với patches đã apply
pnpm fork:build

# 3. Post-build rebrand (rename package.json + rewrite bundle output)
FORK_VERSION=7.8.0 pnpm fork:rebrand

# 4. Build + upload Rust engines (~30-60 phút lần đầu)
FORK_VERSION=7.8.0 pnpm fork:engines:build:wasm
FORK_VERSION=7.8.0 pnpm fork:engines:build:native
FORK_VERSION=7.8.0 pnpm fork:engines:upload
FORK_VERSION=7.8.0 pnpm fork:engines:publish:wasm

# 5. Verify trước khi đẩy JS lên npm
pnpm fork:publish:dry

# 6. Publish thật
pnpm fork:publish              # hoặc: pnpm fork:publish --tag next

# 7. Khôi phục source
pnpm fork:restore
```

### Publish chỉ 1 package (debug nhanh)

```bash
FORK_VERSION=7.8.0 pnpm fork:rebrand
FORK_ONLY=prisma-debug pnpm fork:publish:dry
```

### Build chỉ 1 platform / 1 WASM crate

```bash
# Native: chỉ darwin-arm64 (skip Docker)
pnpm fork:engines:build:native --only darwin-arm64

# WASM: chỉ schema-engine-wasm
FORK_VERSION=7.8.0 pnpm fork:engines:build:wasm --only prisma-schema-engine-wasm
```

## Tham số cấu hình (env / flags)

| Env                   | Flag         | Default                                                      | Mô tả                                                            |
| --------------------- | ------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `FORK_VERSION`        | `--version`  | (bắt buộc)                                                   | Phiên bản semver gán cho mọi package fork                        |
| `FORK_SCOPE`          | `--scope`    | `@vertexa`                                                    | Scope npm                                                        |
| `FORK_TAG`            | `--tag`      | `latest`                                                     | dist-tag truyền cho `npm publish`                                |
| `FORK_DRY_RUN`        | `--dry-run`  | `false`                                                      | Bật dry-run cho mọi script                                       |
| `FORK_ONLY`           | `--only`     | (tất cả)                                                     | Chỉ publish slug được liệt kê (vd `prisma-debug,prisma-engines`) |
| `FORK_OTP`            | `--otp`      | —                                                            | Forward OTP cho 2FA                                              |
| `FORK_REGISTRY`       | `--registry` | —                                                            | Forward registry URL                                             |
| `FORK_GH_REPO`        | `--repo`     | `lh0x00/prisma`                                              | GitHub repo nhận engine binaries                                 |
| `FORK_ENGINES_COMMIT` | `--commit`   | `git -C prisma-engines rev-parse HEAD`                       | Commit hash cho engines-version + release tag                    |
| `FORK_ENGINE_TARGETS` | —            | `darwin-arm64,debian-openssl-3.0.x,linux-musl-openssl-3.0.x` | Comma list platforms để build native                             |
| `FORK_WASM_BUILDER`   | `--builder`  | `docker`                                                     | `host` hoặc `docker`                                             |
| `WASM_BUILD_PROFILE`  | `--profile`  | `release`                                                    | Cargo profile khi build WASM                                     |

## Người dùng cuối dùng fork ra sao

```bash
npm i -D @vertexa/prisma
npm i    @vertexa/prisma-client
```

Generator output (`prisma generate`) sẽ tự `require('@vertexa/prisma-client/runtime/library')`
vì các bundle output đã được rewrite — đây là lý do bước `fork:rebrand`
phải chạy **sau** `fork:build`.

## Cách script hoạt động (tóm tắt)

`scripts/fork/rebrand.ts` thực hiện đúng 2 việc cho mỗi package trong tập 8:

1. **Patch `package.json`**:
   - đổi `name` → tên fork.
   - đặt `version` = `FORK_VERSION`.
   - đổi key của `dependencies` / `peerDependencies` /
     `optionalDependencies` / `peerDependenciesMeta` cho các tên có trong
     mapping; thay `workspace:*` của các fork-deps thành `^FORK_VERSION`.
   - **xoá** `devDependencies` (chứa nhiều `workspace:*` không thể publish và
     `npm install` không cần — toàn bộ generator/internals đã bundle).
   - xoá script lifecycle nguy hiểm (`prepublishOnly`, `prepare`, `prepack`,
     `postpublish`) tránh re-trigger build trong lúc `npm publish`.
   - đảm bảo `publishConfig.access = "public"`.

2. **Rewrite bundle output**:
   - đi qua `build/`, `dist/`, `runtime/`, `generator-build/`, `prisma-client/`,
     `install/`, `preinstall/`, `download/`, `scripts/`, …
   - thay literal string `@prisma/client`, `@prisma/engines`, `prisma`, …
     (giới hạn ở các vị trí có ranh giới `"`/`'`/`` ` ``/`/` để tránh động
     vào tên biến random) thành tên fork tương ứng.
   - bỏ qua `package.json` (đã handle ở bước 1) để tránh double-encoding.

`scripts/fork/publish-fork.ts` chạy `npm publish --ignore-scripts` từng package
theo thứ tự topo `debug → driver-adapter-utils → adapter-pg → get-platform →
engines-version → fetch-engine → engines → config → client-runtime-utils →
client → cli`.

## Khi nào cần đụng vào script

- Muốn publish thêm 1 package phụ (vd `@prisma/instrumentation`):
  thêm entry vào `FORK_PACKAGES` trong `scripts/fork/fork.config.ts`. Đặt
  vào đúng vị trí topo (sau các package mà nó depend tới).
- Muốn đổi scope: set `FORK_SCOPE=@your-scope` (không cần sửa code).
- Muốn 1 vài package giữ tên gốc: bỏ entry tương ứng khỏi `FORK_PACKAGES`.

## Khắc phục sự cố

- `Working tree is dirty under packages/`: chạy `pnpm fork:restore` hoặc
  commit/stash các thay đổi local trước.
- `npm publish` báo `403 Forbidden`: kiểm tra `npm whoami`, đảm bảo scope
  `@vertexa` thuộc account của bạn (hoặc tổ chức bạn có quyền).
- `npm publish` báo `cannot publish over previously published version`:
  bump `FORK_VERSION` (ví dụ `7.8.1`).
- Engine không tải được khi user cài fork: kiểm tra rằng `@prisma/engines-version`
  trong `packages/engines/package.json` của fork vẫn trỏ tới một version
  hợp lệ trên npm — đây là source-of-truth cho URL Rust binaries.
