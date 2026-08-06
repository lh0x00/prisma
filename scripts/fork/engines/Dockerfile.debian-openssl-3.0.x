# Builder image for the `debian-openssl-3.0.x` engine target.
# Pinned to Debian 12 (bookworm) which ships OpenSSL 3.0.x.
#
# Usage (from repo root):
#   docker build -f scripts/fork/engines/Dockerfile.debian-openssl-3.0.x \
#     -t vertexa/prisma-builder:debian-3.0.x scripts/fork/engines
#   docker run --rm \
#     -v "$PWD/prisma-engines:/src" \
#     -v "$PWD/dist-engines:/out" \
#     -v "${HOME}/.cargo/registry:/root/.cargo/registry" \
#     vertexa/prisma-builder:debian-3.0.x
#
# `scripts/fork/engines/build-native.ts` automates these calls.

FROM rust:1.86-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cmake \
      curl \
      git \
      libssl-dev \
      pkg-config \
      protobuf-compiler \
 && rm -rf /var/lib/apt/lists/*

# Default location for bind-mounted prisma-engines source.
WORKDIR /src

# Output dir for the gzipped binary (mounted by the runner).
ENV OUT_DIR=/out
ENV BINARY_NAME=schema-engine
ENV CARGO_TARGET=x86_64-unknown-linux-gnu
ENV TARGET_SLUG=debian-openssl-3.0.x

ENTRYPOINT ["/bin/bash", "-c", "set -euo pipefail; \
  cargo build --release --target ${CARGO_TARGET} -p schema-engine-cli; \
  install -d \"${OUT_DIR}/${TARGET_SLUG}\"; \
  install -m0755 \"target/${CARGO_TARGET}/release/${BINARY_NAME}\" \"${OUT_DIR}/${TARGET_SLUG}/${BINARY_NAME}\"; \
  gzip -fk \"${OUT_DIR}/${TARGET_SLUG}/${BINARY_NAME}\"; \
  ( cd \"${OUT_DIR}/${TARGET_SLUG}\" && sha256sum \"${BINARY_NAME}.gz\" | awk '{print $1\"  \"$2}' > \"${BINARY_NAME}.gz.sha256\" ); \
  echo \"built ${TARGET_SLUG}/${BINARY_NAME}.gz\""]
