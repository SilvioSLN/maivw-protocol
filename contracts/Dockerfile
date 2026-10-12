FROM ghcr.io/foundry-rs/foundry@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 AS builder

WORKDIR /app

# Copy contract sources
COPY foundry.toml .
COPY lib/ lib/
COPY src/ src/
COPY test/ test/
COPY script/ script/

# Compile contracts
RUN forge build

# ---- Deploy stage ----
FROM ghcr.io/foundry-rs/foundry@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 AS deployer

WORKDIR /app

COPY --from=builder /app/ .

ENTRYPOINT ["forge"]
