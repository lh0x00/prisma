# Builder image for the `linux-musl-openssl-3.0.x` engine target.
# Built on Alpine 3.20 (musl libc + OpenSSL 3.0.x).
#
# Usage (from repo root):
#   docker build -f scripts/fork/engines/Dockerfile.linux-musl-openssl-3.0.x \
#     -t vertexa/prisma-builder:musl-3.0.x scripts/fork/engines
#   docker run --rm \
#     -v "$PWD/prisma-engines:/src" \
#     -v "$PWD/dist-engines:/out" \
#     -v "${HOME}/.cargo/registry:/root/.cargo/registry" \
#     vertexa/prisma-builder:musl-3.0.x

FROM rust:1.86-alpine3.20

RUN apk add --no-cache \
      bash \
      build-base \
      ca-certificates \
      cmake \
      coreutils \
      curl \
      git \
      musl-dev \
      openssl-dev \
      openssl-libs-static \
      perl \
      pkgconfig \
      protobuf-dev \
      zlib-dev

# Statically link OpenSSL into the resulting binary so it runs on plain
# Alpine images without the host having to ship libssl.
ENV OPENSSL_STATIC=1
ENV OPENSSL_LIB_DIR=/usr/lib
ENV OPENSSL_INCLUDE_DIR=/usr/include

WORKDIR /src

ENV OUT_DIR=/out
ENV BINARY_NAME=schema-engine
ENV CARGO_TARGET=x86_64-unknown-linux-musl
ENV TARGET_SLUG=linux-musl-openssl-3.0.x

ENTRYPOINT ["/bin/bash", "-c", "set -euo pipefail; \
  rustup target add ${CARGO_TARGET}; \
  cargo build --release --target ${CARGO_TARGET} -p schema-engine-cli; \
  install -d \"${OUT_DIR}/${TARGET_SLUG}\"; \
  install -m0755 \"target/${CARGO_TARGET}/release/${BINARY_NAME}\" \"${OUT_DIR}/${TARGET_SLUG}/${BINARY_NAME}\"; \
  gzip -fk \"${OUT_DIR}/${TARGET_SLUG}/${BINARY_NAME}\"; \
  ( cd \"${OUT_DIR}/${TARGET_SLUG}\" && sha256sum \"${BINARY_NAME}.gz\" | awk '{print $1\"  \"$2}' > \"${BINARY_NAME}.gz.sha256\" ); \
  echo \"built ${TARGET_SLUG}/${BINARY_NAME}.gz\""]
