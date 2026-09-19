# SUCCRA solana-e2e toolchain image.
#
# Why this exists: the solana-e2e CI job failed 11+ times installing
# Anchor 0.32.1 on GitHub-hosted runners (exit 101 across avm, release
# binary, and crates.io strategies). A pinned image makes the toolchain
# deterministic: the same bytes on every run.
#
# Base: ubuntu:24.04. The Anchor 0.32.1 prebuilt binary requires GLIBC
# 2.39, which 24.04 ships; 22.04 (GLIBC 2.35) was tried first and failed
# at `anchor --version` with `GLIBC_2.39 not found` (CI run #20).
#
# Anchor install path: prebuilt release binary (NOT cargo install).
# `cargo install anchor-cli --version 0.32.1 --locked` was the step that
# kept failing on runners; v0.32.1 ships
# anchor-0.32.1-x86_64-unknown-linux-gnu, so the image downloads 13 MB
# (sha256-pinned below) instead of compiling for 10+ minutes.
#
# Node/pnpm: installed in-image (self-contained) so the mocha suite runs
# without setup-node/pnpm-action inside the container job. Node 24.20.0
# matches the locally verified toolchain; pnpm comes from corepack per
# the repo's packageManager pin (pnpm@12.3.4).
#
# No secrets, tokens, or PATs are embedded in this image.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    SOLANA_VERSION=2.3.0 \
    ANCHOR_VERSION=0.32.1 \
    ANCHOR_SHA256=5f25b850ce80278507a98947833fcd48423391f6d145046ffb0c5fd130dec436 \
    PLATFORM_TOOLS_VERSION=1.48 \
    NODE_VERSION=24.20.0 \
    PNPM_VERSION=12.3.4 \
    CARGO_HOME=/root/.cargo \
    RUSTUP_HOME=/root/.rustup \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH="/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:/opt/node/bin:/usr/local/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev libudev-dev curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Rust (stable channel, minimal profile) — same channel the solana-cargo
# job uses (dtolnay/rust-toolchain@stable). An exact rustc pin is
# deliberately avoided: anchor 0.32.1's locked deps track recent stable.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustc --version && cargo --version

# Solana 2.3.0 (Agave) via the release.anza.xyz installer already used in CI.
RUN curl -sSfL "https://release.anza.xyz/v${SOLANA_VERSION}/install" -o /tmp/solana-install.sh \
    && test -s /tmp/solana-install.sh \
    && sh /tmp/solana-install.sh \
    && rm /tmp/solana-install.sh \
    && solana --version | grep -q '2.3.0'

# Anchor 0.32.1 prebuilt Linux binary, sha256-verified.
RUN curl -sSfL "https://github.com/solana-foundation/anchor/releases/download/v${ANCHOR_VERSION}/anchor-${ANCHOR_VERSION}-x86_64-unknown-linux-gnu" \
    -o /tmp/anchor-bin \
    && echo "${ANCHOR_SHA256}  /tmp/anchor-bin" | sha256sum -c - \
    && install -m 0755 /tmp/anchor-bin /usr/local/bin/anchor \
    && rm /tmp/anchor-bin \
    && anchor --version | grep -q '0.32.1'

# Node 24 + pnpm (corepack, repo-pinned version).
RUN curl -sSfL "https://nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
    -o /tmp/node.tgz \
    && mkdir -p /opt/node && tar -xzf /tmp/node.tgz -C /opt/node --strip-components=1 \
    && rm /tmp/node.tgz \
    && node --version \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && pnpm --version

# Bake Solana platform-tools v1.48 using the exact flags proven locally
# (dummy crate: the repo is mounted at runtime, never baked in).
RUN cargo new --lib /tmp/toolwarm \
    && cargo build-sbf --tools-version "${PLATFORM_TOOLS_VERSION}" --force-tools-install \
        --manifest-path /tmp/toolwarm/Cargo.toml \
    && rm -rf /tmp/toolwarm \
    && cargo build-sbf --version

WORKDIR /work
