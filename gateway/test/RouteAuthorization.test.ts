import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "route-auth-test-secret-key-12345";
process.env.INTERNAL_SERVICE_KEY = "internal-secret-token-xyz";

const { settingsRoutes } = await import("../src/routes/settings.js");
const { stealthRoutes } = await import("../src/routes/stealth.js");
const { routingRoutes } = await import("../src/routes/routing.js");
const { oracleRoutes } = await import("../src/routes/oracle.js");
const { economicsRoutes } = await import("../src/routes/economics.js");
const { multiChainRoutes } = await import("../src/routes/multichain.js");
const { nodeRoutes } = await import("../src/routes/node.js");

const secret = process.env.JWT_SECRET;
const internalKey = process.env.INTERNAL_SERVICE_KEY;

const userClaims = { id: 10, email: "user@example.com", role: "user" };
const adminClaims = { id: 1, email: "admin@example.com", role: "admin" };
const otherAdminClaims = { id: 2, email: "admin2@other.com", role: "admin" };

const authHeader = (claims: any) => ({
  authorization: `Bearer ${jwt.sign(claims, secret)}`,
});

function createMockPrisma() {
  const users = new Map<number, any>([
    [1, { id: 1, email: "admin@example.com", role: "admin" }],
    [2, { id: 2, email: "admin2@other.com", role: "admin" }],
    [10, { id: 10, email: "user@example.com", role: "user" }],
  ]);

  const domains = [
    { id: 1, domainName: "example.com", userId: 1, isVerified: true, accounts: [], smtpConfig: null },
    { id: 2, domainName: "other.com", userId: 2, isVerified: true, accounts: [], smtpConfig: null },
    { id: 3, domainName: "unverified.com", userId: 1, isVerified: false, accounts: [], smtpConfig: null },
  ];

  return {
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) || null,
    },
    domain: {
      findFirst: async ({ where }: any) => {
        return domains.find((d) => {
          if (where.id && d.id !== where.id) return false;
          if (where.userId && d.userId !== where.userId) return false;
          if (where.domainName && d.domainName !== where.domainName) return false;
          if (where.isVerified !== undefined && d.isVerified !== where.isVerified) return false;
          return true;
        }) || null;
      },
      findUnique: async ({ where }: any) => domains.find((d) => d.id === where.id) || null,
    },
    smtpConfig: {
      findFirst: async () => null,
      upsert: async () => ({ id: 1 }),
    },
    message: {
      count: async () => 0,
      findMany: async () => [],
    },
    reputation: {
      findFirst: async () => null,
    },
  } as any;
}

test("settingsRoutes: require active admin and enforce domain ownership", async () => {
  const prisma = createMockPrisma();
  const app = Fastify();
  await app.register(settingsRoutes, {
    prisma,
    smtp: { testConnection: async () => ({ success: true }) } as any,
    masterKey: "0123456789abcdef0123456789abcdef",
  });

  try {
    // 1. Anonymous -> 401
    const resAnon = await app.inject({ method: "GET", url: "/api/v1/settings/smtp" });
    assert.equal(resAnon.statusCode, 401);

    // 2. Regular user (role: 'user') -> 403
    const resUser = await app.inject({
      method: "GET",
      url: "/api/v1/settings/smtp",
      headers: authHeader(userClaims),
    });
    assert.equal(resUser.statusCode, 403);

    // 3. Admin accessing domain of another user -> 404
    const resCrossDomain = await app.inject({
      method: "GET",
      url: "/api/v1/settings/domain/2", // Domain 2 belongs to userId: 2
      headers: authHeader(adminClaims), // Caller is userId: 1
    });
    assert.equal(resCrossDomain.statusCode, 404);

    // 4. Admin accessing own domain -> 200
    const resOwnDomain = await app.inject({
      method: "GET",
      url: "/api/v1/settings/domain/1",
      headers: authHeader(adminClaims),
    });
    assert.equal(resOwnDomain.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("stealthRoutes: enforce platform service key and domain ownership", async () => {
  const prisma = createMockPrisma();
  const app = Fastify();
  const stealth = {
    listRoutes: async () => [],
    getStealthConfig: async () => ({ mode: "public", isStealthEnabled: false }),
  } as any;
  const ledger = {
    isDomainRegistered: async () => true,
    getCompanyProfile: async () => null,
  } as any;

  await app.register(stealthRoutes, {
    stealth,
    ledger,
    prisma,
    internalServiceKey: internalKey,
  });

  try {
    // 1. Platform routes require internal service key
    const resNoKey = await app.inject({ method: "GET", url: "/api/v1/stealth/routes" });
    assert.equal(resNoKey.statusCode, 403);

    const resWithKey = await app.inject({
      method: "GET",
      url: "/api/v1/stealth/routes",
      headers: { "x-internal-service-key": internalKey },
    });
    assert.equal(resWithKey.statusCode, 200);

    // 2. Domain stealth config requires admin owner of verified domain
    const resCross = await app.inject({
      method: "GET",
      url: "/api/v1/stealth/config/other.com", // Belongs to userId 2
      headers: authHeader(adminClaims), // Caller is userId 1
    });
    assert.equal(resCross.statusCode, 404);

    const resUnverified = await app.inject({
      method: "GET",
      url: "/api/v1/stealth/config/unverified.com",
      headers: authHeader(adminClaims),
    });
    assert.equal(resUnverified.statusCode, 404);

    const resOwn = await app.inject({
      method: "GET",
      url: "/api/v1/stealth/config/example.com",
      headers: authHeader(adminClaims),
    });
    assert.equal(resOwn.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("routingRoutes and oracleRoutes: enforce internal service key", async () => {
  const prisma = {
    ...createMockPrisma(),
    endpointPool: { findMany: async () => [] },
  };
  const app = Fastify();
  const routingPool = { getPools: async () => [] } as any;
  const ledger = {
    getOracleNode: async () => "0x1111111111111111111111111111111111111111",
    getClient: () => ({ getBalance: async (_args?: any) => 1000000000000000000n }),
  } as any;

  await app.register(routingRoutes, { prisma, routingPool, internalServiceKey: internalKey });
  await app.register(oracleRoutes, { ledger, internalServiceKey: internalKey });

  try {
    // routing/pools
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/routing/pools" })).statusCode, 403);
    assert.equal(
      (await app.inject({
        method: "GET",
        url: "/api/v1/routing/pools",
        headers: { "x-internal-service-key": internalKey },
      })).statusCode,
      200
    );

    // oracle/status
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/oracle/status" })).statusCode, 403);
    assert.equal(
      (await app.inject({
        method: "GET",
        url: "/api/v1/oracle/status",
        headers: { "x-internal-service-key": internalKey },
      })).statusCode,
      200
    );
  } finally {
    await app.close();
  }
});

test("economicsRoutes and multiChainRoutes: require active admin and verified domain ownership", async () => {
  const prisma = createMockPrisma();
  const app = Fastify();
  const ledger = {
    getSupportedNetworks: () => [{ id: 84532, name: "Base Sepolia", isPrimary: true }],
    getCompanyProfile: async () => ({ isActive: true, publicKey: "0x2222222222222222222222222222222222222222" }),
  } as any;
  const oracle = {
    getOracleAddress: () => "0x1111111111111111111111111111111111111111",
    generateMirrorProof: async () => "proof",
  } as any;

  await app.register(economicsRoutes, { ledger, prisma });
  await app.register(multiChainRoutes, { ledger, oracle, prisma, internalServiceKey: internalKey });

  try {
    // economics/topup: anonymous -> 401, cross-domain -> 404
    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/v1/economics/topup",
        payload: { domain: "example.com", amountEth: "1" },
      })).statusCode,
      401
    );

    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/v1/economics/topup",
        headers: authHeader(adminClaims), // userId 1
        payload: { domain: "other.com", amountEth: "1" }, // other.com belongs to userId 2
      })).statusCode,
      404
    );

    // multichain/attest-mirror: cross-domain -> 404
    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/v1/multichain/attest-mirror",
        headers: authHeader(adminClaims),
        payload: { domain: "other.com", targetChainId: 84532 },
      })).statusCode,
      404
    );

    // multichain/attest-mirror: executeRelayer is suspended with 503
    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/v1/multichain/attest-mirror",
        headers: authHeader(adminClaims),
        payload: { domain: "example.com", targetChainId: 84532, executeRelayer: true },
      })).statusCode,
      503
    );

    // multichain/fulfill-mirror: suspended with 503
    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/v1/multichain/fulfill-mirror",
        headers: { "x-internal-service-key": internalKey },
        payload: { domain: "example.com", targetChainId: 84532 },
      })).statusCode,
      503
    );
  } finally {
    await app.close();
  }
});

test("nodeRoutes: telemetry does not return mock demonstrative numbers", async () => {
  const prisma = createMockPrisma();
  const app = Fastify();
  const config = {
    SENDER_DOMAIN: "empresa.local",
    CHAIN_ID: 31337,
    REGISTRY_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
  } as any;
  const ledger = {
    getCompanyProfile: async () => null,
    getBlockNumber: async () => 100n,
    getClient: () => ({ getBalance: async () => 1000n }),
  } as any;
  const signer = { address: "0x3333333333333333333333333333333333333333" } as any;

  await app.register(nodeRoutes, { config, ledger, signer, prisma });

  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/node/telemetry" });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);

    // Ensure trafficHistory and securityEvents are empty, not mocked
    assert.deepEqual(data.trafficHistory, []);
    assert.deepEqual(data.securityEvents, []);

    // Ensure demonstrative rates are null, not hardcoded "100%" or "84%"
    assert.equal(data.traffic.cryptographicSuccessRate, null);
    assert.equal(data.traffic.p2pDeliveryRate, null);
    assert.equal(data.traffic.avgLatencyMs, null);
    assert.equal(data.traffic.queuePending, null);

    // Ensure totalProcessed equals totalReceived and is not mock 1482
    assert.equal(data.traffic.totalProcessed, 0);
    assert.equal(data.traffic.totalReceived, 0);
    assert.equal(data.traffic.validSignatures, 0);
    assert.equal(data.traffic.spoofingBlocked, 0);
  } finally {
    await app.close();
  }
});
