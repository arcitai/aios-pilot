FROM node:24.15.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git python3 unzip xz-utils zip \
    clang cmake ninja-build pkg-config file libssl-dev libasound2-dev \
    libayatana-appindicator3-dev libgtk-3-dev librsvg2-dev \
    libwebkit2gtk-4.1-dev libxdo-dev patchelf \
    && rm -rf /var/lib/apt/lists/*
COPY bin /opt/aios-toolchain/bin
COPY rust-toolchain.toml /opt/aios-toolchain/rust-toolchain.toml
ENV HERMIT_CACHE=/opt/hermit-cache RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
WORKDIR /opt/aios-toolchain
RUN ./bin/hermit install && ./bin/rustc --version && ./bin/cargo --version \
    && ./bin/just --version && ./bin/pnpm --version && ./bin/flutter --version \
    && ./bin/actionlint -version
RUN mkdir -p /opt/cargo && mv /root/.cache/hermit /opt/hermit-cache && chmod -R a+rX /opt/hermit-cache /opt/rustup /opt/cargo
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client redis-tools \
    && rm -rf /var/lib/apt/lists/*
# Git >=2.46 is required by the Nostr credential helper's authtype protocol.
RUN apt-get update && apt-get install -y --no-install-recommends libcurl4-openssl-dev libexpat1-dev gettext \
    && curl -fsSLo /tmp/git.tar.xz https://www.kernel.org/pub/software/scm/git/git-2.55.0.tar.xz \
    && echo '457fdb04dc8728e007d4688695e6912e6f680727920f2a40bf11eacc17505357  /tmp/git.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/git.tar.xz -C /tmp \
    && RUSTUP_TOOLCHAIN=1.95.0 HERMIT_STATE_DIR=/opt/hermit-cache PATH=/opt/aios-toolchain/bin:$PATH make -C /tmp/git-2.55.0 -j4 prefix=/usr/local NO_TCLTK=YesPlease install \
    && rm -rf /tmp/git.tar.xz /tmp/git-2.55.0 /var/lib/apt/lists/*
ENV HERMIT_STATE_DIR=/opt/hermit-cache
ENV PATH=/opt/aios-toolchain/bin:$PATH
USER node
WORKDIR /workspace
