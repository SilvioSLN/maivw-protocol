FROM ghcr.io/foundry-rs/foundry@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 AS builder

WORKDIR /app

# Copy contract sources
COPY foundry.toml .
COPY lib/ lib/
COPY src/ src/
COPY test/ test/
COPY script/ script/

# Compile contracts (auto-populates pinned Foundry/OpenZeppelin libs if cloned without --recurse-submodules)
RUN if [ ! -d "lib/forge-std/src" ]; then \
      rm -rf lib/forge-std lib/openzeppelin-contracts lib/openzeppelin-contracts-upgradeable && \
      git clone --no-checkout https://github.com/foundry-rs/forge-std.git lib/forge-std && \
      git -C lib/forge-std checkout 0258fe875e1d8e207c1eb7175e542ea32356773c && \
      git clone --no-checkout https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts && \
      git -C lib/openzeppelin-contracts checkout 69c8def5f222ff96f2b5beff05dfba996368aa79 && \
      git clone --no-checkout https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable.git lib/openzeppelin-contracts-upgradeable && \
      git -C lib/openzeppelin-contracts-upgradeable checkout fa525310e45f91eb20a6d3baa2644be8e0adba31; \
    fi && forge build

# ---- Deploy stage ----
FROM ghcr.io/foundry-rs/foundry@sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17 AS deployer

WORKDIR /app

COPY --from=builder /app/ .

ENTRYPOINT ["forge"]
