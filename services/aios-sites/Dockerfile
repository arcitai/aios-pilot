FROM rust:1.88-slim-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN useradd --system --uid 10001 --create-home sites \
    && mkdir /data \
    && chown sites:sites /data
COPY --from=builder /src/target/release/aios-sites-publisher /usr/local/bin/aios-sites-publisher
USER sites
ENV AIOS_SITES_DATA_DIR=/data \
    AIOS_SITES_CONTAINER_MODE=1
VOLUME ["/data"]
EXPOSE 3351 3352
ENTRYPOINT ["/usr/local/bin/aios-sites-publisher"]
