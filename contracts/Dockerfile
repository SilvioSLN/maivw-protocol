FROM ghcr.io/foundry-rs/foundry:latest AS builder

WORKDIR /app

# Copy contract sources
COPY foundry.toml .
COPY src/ src/
COPY test/ test/
COPY script/ script/

# Install OpenZeppelin
RUN forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Compile contracts
RUN forge build

# ---- Deploy stage ----
FROM ghcr.io/foundry-rs/foundry:latest AS deployer

WORKDIR /app

COPY --from=builder /app/ .

ENTRYPOINT ["forge"]
