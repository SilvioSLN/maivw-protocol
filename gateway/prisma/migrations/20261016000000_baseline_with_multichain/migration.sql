-- CreateEnum
CREATE TYPE "OriginNetworkFamily" AS ENUM ('EVM', 'SOLANA');

-- CreateEnum
CREATE TYPE "OriginRecordStatus" AS ENUM ('ACTIVE');

-- CreateEnum
CREATE TYPE "OriginAuditAction" AS ENUM ('ORIGIN_ACTIVATED', 'ORIGIN_RECONCILED');

-- CreateEnum
CREATE TYPE "OriginOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "OriginDnsChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OriginRegistrantAlgorithm" AS ENUM ('SECP256K1_EVM', 'ED25519_SOLANA');

-- CreateEnum
CREATE TYPE "OriginReservationStatus" AS ENUM ('RESERVED', 'CLAIM_ISSUED', 'CONSUMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OriginClaimStatus" AS ENUM ('ISSUED', 'SUBMITTED', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OriginReservationAuditAction" AS ENUM ('RESERVATION_CREATED', 'CLAIM_ISSUED', 'RESERVATION_EXPIRED');

-- CreateEnum
CREATE TYPE "EvmObservationStatus" AS ENUM ('FINALIZED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "MultichainRelayStatus" AS ENUM ('DETECTED', 'FINALIZED', 'ATTESTED', 'SUBMITTED', 'CONFIRMED', 'RECONCILE', 'ORPHANED', 'COMPENSATION_REQUIRED');

-- CreateEnum
CREATE TYPE "MultichainRelayOperation" AS ENUM ('REGISTER', 'SYNC', 'REVOKE');

-- CreateEnum
CREATE TYPE "RelaySubmissionStatus" AS ENUM ('PREPARED', 'BROADCAST', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "RelaySubmissionAttemptOutcome" AS ENUM ('BROADCAST', 'RETRY_SCHEDULED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('CLEAN', 'DRIFTED');

-- CreateEnum
CREATE TYPE "ReconciliationFindingKind" AS ENUM ('IN_SYNC', 'MISSING_MIRROR', 'VERSION_BEHIND', 'VERSION_AHEAD', 'STATE_DRIFT', 'ORIGIN_CONFLICT', 'UNREADABLE');

-- CreateEnum
CREATE TYPE "ReconciliationRepairAction" AS ENUM ('NONE', 'REGISTER', 'SYNC', 'REVOKE', 'RETRY_READ', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "RelayReorgOutcome" AS ENUM ('ORPHANED', 'COMPENSATION_REQUIRED');

-- CreateEnum
CREATE TYPE "RelayCompensationStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "RelayCircuitStatus" AS ENUM ('CLOSED', 'OPEN');

-- CreateEnum
CREATE TYPE "RelayCircuitScopeKind" AS ENUM ('GLOBAL', 'DOMAIN', 'DEPLOYMENT', 'DOMAIN_DEPLOYMENT');

-- CreateEnum
CREATE TYPE "RelayCircuitSignalKind" AS ENUM ('ORIGIN_CONFLICT', 'STATE_DRIFT', 'RPC_DIVERGENCE', 'LOW_BALANCE', 'RELAY_FAILURE', 'RELAY_SUCCESS', 'MANUAL_RESET');

-- CreateEnum
CREATE TYPE "RelayCircuitEventAction" AS ENUM ('SIGNAL_RECORDED', 'TRIPPED', 'FAILURE_COUNTER_RESET', 'MANUAL_RESET');

-- CreateTable
CREATE TABLE "EvmObserverCursor" (
    "networkId" TEXT NOT NULL,
    "networkName" TEXT NOT NULL,
    "chainId" BIGINT NOT NULL,
    "registryAddress" CHAR(42) NOT NULL,
    "registryId" CHAR(66) NOT NULL,
    "confirmations" INTEGER NOT NULL,
    "startBlock" BIGINT NOT NULL,
    "nextBlock" BIGINT NOT NULL,
    "lastProcessedBlock" BIGINT,
    "lastProcessedHash" CHAR(66),
    "observedHead" BIGINT,
    "finalizedHead" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvmObserverCursor_pkey" PRIMARY KEY ("networkId")
);

-- CreateTable
CREATE TABLE "EvmObservedBlock" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" CHAR(66) NOT NULL,
    "parentHash" CHAR(66) NOT NULL,
    "status" "EvmObservationStatus" NOT NULL DEFAULT 'FINALIZED',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orphanedAt" TIMESTAMP(3),

    CONSTRAINT "EvmObservedBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvmSourceEvent" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "registryId" CHAR(66) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" CHAR(66) NOT NULL,
    "transactionHash" CHAR(66) NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "domainHash" CHAR(66),
    "payload" JSONB NOT NULL,
    "status" "EvmObservationStatus" NOT NULL DEFAULT 'FINALIZED',
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orphanedAt" TIMESTAMP(3),

    CONSTRAINT "EvmSourceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolanaObserverCursor" (
    "networkId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "commitment" TEXT NOT NULL,
    "startSlot" BIGINT NOT NULL,
    "lastSlot" BIGINT,
    "lastSignature" TEXT,
    "observedSlot" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolanaObserverCursor_pkey" PRIMARY KEY ("networkId")
);

-- CreateTable
CREATE TABLE "SolanaObservedTransaction" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "signature" TEXT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolanaObservedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolanaSourceEvent" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "signature" TEXT NOT NULL,
    "instructionIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "domainHash" CHAR(66),
    "payload" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolanaSourceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayJob" (
    "id" TEXT NOT NULL,
    "sourceEventKey" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "operation" "MultichainRelayOperation" NOT NULL,
    "originNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "originNetworkId" TEXT NOT NULL,
    "originRegistryId" CHAR(66) NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "sourcePosition" TEXT NOT NULL,
    "globalDomainEpoch" BIGINT NOT NULL,
    "originSequence" BIGINT NOT NULL,
    "status" "MultichainRelayStatus" NOT NULL DEFAULT 'DETECTED',
    "sourceStateHash" CHAR(66),
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultichainRelayJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayReorg" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceEventKey" TEXT NOT NULL,
    "requestHash" CHAR(66) NOT NULL,
    "orphanedSourceReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "outcome" "RelayReorgOutcome" NOT NULL,
    "previousAuditHash" CHAR(66),
    "auditHash" CHAR(66) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainRelayReorg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayCompensation" (
    "id" TEXT NOT NULL,
    "reorgId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "destinationNetworkId" TEXT NOT NULL,
    "destinationRegistryId" CHAR(66) NOT NULL,
    "submittedTransactionId" TEXT,
    "action" TEXT NOT NULL,
    "status" "RelayCompensationStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionReference" TEXT,
    "auditHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MultichainRelayCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayCircuitBreaker" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scopeKind" "RelayCircuitScopeKind" NOT NULL,
    "domainHash" CHAR(66),
    "networkId" TEXT,
    "registryId" CHAR(66),
    "status" "RelayCircuitStatus" NOT NULL DEFAULT 'CLOSED',
    "triggerSignal" "RelayCircuitSignalKind",
    "reason" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "failureThreshold" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "lastAuditHash" CHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultichainRelayCircuitBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayCircuitEvent" (
    "id" TEXT NOT NULL,
    "breakerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" CHAR(66) NOT NULL,
    "signalKind" "RelayCircuitSignalKind" NOT NULL,
    "action" "RelayCircuitEventAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "resultingStatus" "RelayCircuitStatus" NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL,
    "previousAuditHash" CHAR(66),
    "auditHash" CHAR(66) NOT NULL,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainRelayCircuitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayDestination" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "destinationNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "destinationNetworkId" TEXT NOT NULL,
    "destinationRegistryId" CHAR(66) NOT NULL,
    "status" "MultichainRelayStatus" NOT NULL DEFAULT 'DETECTED',
    "attestationDigest" CHAR(66),
    "submissionId" TEXT,
    "confirmationReference" TEXT,
    "reconcileReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultichainRelayDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelaySubmission" (
    "id" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "signedPayload" TEXT NOT NULL,
    "signedPayloadHash" CHAR(66) NOT NULL,
    "expectedTransactionId" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "RelaySubmissionStatus" NOT NULL DEFAULT 'PREPARED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "finalityReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultichainRelaySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelaySubmissionAttempt" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "outcome" "RelaySubmissionAttemptOutcome" NOT NULL,
    "transactionId" TEXT,
    "finalityRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainRelaySubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainReconciliationRun" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" CHAR(66) NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "originNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "originNetworkId" TEXT NOT NULL,
    "originRegistryId" CHAR(66) NOT NULL,
    "globalDomainEpoch" BIGINT NOT NULL,
    "originSequence" BIGINT NOT NULL,
    "originStateHash" CHAR(66) NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL,
    "previousAuditHash" CHAR(66),
    "auditHash" CHAR(66) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainReconciliationFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "destinationNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "destinationNetworkId" TEXT NOT NULL,
    "destinationRegistryId" CHAR(66) NOT NULL,
    "kind" "ReconciliationFindingKind" NOT NULL,
    "repairAction" "ReconciliationRepairAction" NOT NULL,
    "mirrorStateHash" CHAR(66),
    "mirrorGlobalDomainEpoch" BIGINT,
    "mirrorOriginSequence" BIGINT,
    "details" JSONB NOT NULL,
    "repair" JSONB NOT NULL,
    "auditHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainReconciliationFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultichainRelayTransition" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "destinationId" TEXT,
    "fromStatus" "MultichainRelayStatus",
    "toStatus" "MultichainRelayStatus" NOT NULL,
    "artifactHash" CHAR(66),
    "reference" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultichainRelayTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginRecord" (
    "id" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "domain" TEXT NOT NULL,
    "originNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "originNetworkId" TEXT NOT NULL,
    "originNetworkHash" CHAR(66) NOT NULL,
    "originRegistryId" CHAR(66) NOT NULL,
    "originVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "OriginRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "originTxFamily" "OriginNetworkFamily" NOT NULL,
    "originTxId" TEXT NOT NULL,
    "globalDomainEpoch" BIGINT NOT NULL,
    "originSequence" BIGINT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "lastReconciledAt" TIMESTAMP(3),
    "lastAuditHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OriginRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginAuditEvent" (
    "id" TEXT NOT NULL,
    "ordinal" BIGSERIAL NOT NULL,
    "originRecordId" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "action" "OriginAuditAction" NOT NULL,
    "previousState" JSONB,
    "nextState" JSONB NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorIdHash" CHAR(66),
    "requestId" TEXT NOT NULL,
    "previousEventHash" CHAR(66),
    "eventHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OriginAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginOutboxEvent" (
    "id" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OriginOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OriginOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginDnsChallenge" (
    "id" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "domain" TEXT NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "originNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "originNetworkId" TEXT NOT NULL,
    "originNetworkHash" CHAR(66) NOT NULL,
    "originRegistryId" CHAR(66) NOT NULL,
    "registrantAlgorithm" "OriginRegistrantAlgorithm" NOT NULL,
    "registrantKey" CHAR(66) NOT NULL,
    "tokenHash" CHAR(66) NOT NULL,
    "contextHash" CHAR(66) NOT NULL,
    "dnsValueHash" CHAR(66) NOT NULL,
    "status" "OriginDnsChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OriginDnsChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginReservation" (
    "id" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "blockingDomainHash" CHAR(66),
    "domain" TEXT NOT NULL,
    "dnsChallengeId" TEXT NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "originNetworkFamily" "OriginNetworkFamily" NOT NULL,
    "originNetworkId" TEXT NOT NULL,
    "originNetworkHash" CHAR(66) NOT NULL,
    "originRegistryId" CHAR(66) NOT NULL,
    "registrantAlgorithm" "OriginRegistrantAlgorithm" NOT NULL,
    "registrantKey" CHAR(66) NOT NULL,
    "dnsEvidenceHash" CHAR(66) NOT NULL,
    "nonce" CHAR(66) NOT NULL,
    "status" "OriginReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "idempotencyKeyHash" CHAR(66) NOT NULL,
    "requestHash" CHAR(66) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimDeadline" TIMESTAMP(3),
    "holdUntil" TIMESTAMP(3) NOT NULL,
    "lastAuditHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OriginReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginClaimIssuance" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "codecVersion" INTEGER NOT NULL DEFAULT 1,
    "encoded" VARCHAR(586) NOT NULL,
    "digest" CHAR(66) NOT NULL,
    "signedBytesHash" CHAR(66) NOT NULL,
    "signature" TEXT NOT NULL,
    "signerKeyId" TEXT NOT NULL,
    "signerKeyVersion" TEXT NOT NULL,
    "nonce" CHAR(66) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "payloadHash" CHAR(66) NOT NULL,
    "evidenceHash" CHAR(66) NOT NULL,
    "idempotencyKeyHash" CHAR(66) NOT NULL,
    "requestHash" CHAR(66) NOT NULL,
    "status" "OriginClaimStatus" NOT NULL DEFAULT 'ISSUED',
    "submittedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "onChainTxFamily" "OriginNetworkFamily",
    "onChainTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OriginClaimIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginReservationAuditEvent" (
    "id" TEXT NOT NULL,
    "ordinal" BIGSERIAL NOT NULL,
    "reservationId" TEXT NOT NULL,
    "domainHash" CHAR(66) NOT NULL,
    "action" "OriginReservationAuditAction" NOT NULL,
    "previousState" JSONB,
    "nextState" JSONB NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorIdHash" CHAR(66),
    "requestId" TEXT NOT NULL,
    "previousEventHash" CHAR(66),
    "eventHash" CHAR(66) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OriginReservationAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OriginReservationOutboxEvent" (
    "id" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OriginOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OriginReservationOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reputation" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "subIdentityId" TEXT NOT NULL DEFAULT 'default',
    "reputationScore" INTEGER NOT NULL DEFAULT 100,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "lastViolation" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" SERIAL NOT NULL,
    "domainName" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" SERIAL NOT NULL,
    "keyHash" TEXT NOT NULL,
    "domainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletVault" (
    "id" SERIAL NOT NULL,
    "domainId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmtpConfig" (
    "id" SERIAL NOT NULL,
    "domainId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "encryptedApiKey" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT 'MAIVW',
    "fromEmail" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmtpConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAccount" (
    "id" SERIAL NOT NULL,
    "localPart" TEXT NOT NULL,
    "domainId" INTEGER NOT NULL,
    "userId" INTEGER,
    "displayName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "messageId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "msgClass" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "signature" TEXT,
    "isLegacy" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revocationReason" TEXT,
    "domainId" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateRoute" (
    "id" SERIAL NOT NULL,
    "targetDomain" TEXT NOT NULL,
    "privateEndpointUrl" TEXT NOT NULL,
    "stealthToken" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StealthConfig" (
    "id" SERIAL NOT NULL,
    "domainName" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'public',
    "isStealthEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inboundToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StealthConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndpointPool" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT DEFAULT 'GLOBAL',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndpointNode" (
    "id" SERIAL NOT NULL,
    "poolId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHealthy" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailure" TIMESTAMP(3),
    "lastChecked" TIMESTAMP(3),
    "responseTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainRouteRule" (
    "id" SERIAL NOT NULL,
    "domainPattern" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainRouteRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvmObserverCursor_chainId_key" ON "EvmObserverCursor"("chainId");

-- CreateIndex
CREATE INDEX "EvmObservedBlock_networkId_status_blockNumber_idx" ON "EvmObservedBlock"("networkId", "status", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EvmObservedBlock_networkId_blockNumber_blockHash_key" ON "EvmObservedBlock"("networkId", "blockNumber", "blockHash");

-- CreateIndex
CREATE INDEX "EvmSourceEvent_networkId_status_blockNumber_transactionInde_idx" ON "EvmSourceEvent"("networkId", "status", "blockNumber", "transactionIndex", "logIndex");

-- CreateIndex
CREATE INDEX "EvmSourceEvent_domainHash_status_idx" ON "EvmSourceEvent"("domainHash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EvmSourceEvent_networkId_blockHash_transactionHash_logIndex_key" ON "EvmSourceEvent"("networkId", "blockHash", "transactionHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SolanaObserverCursor_programId_key" ON "SolanaObserverCursor"("programId");

-- CreateIndex
CREATE INDEX "SolanaObservedTransaction_networkId_slot_idx" ON "SolanaObservedTransaction"("networkId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "SolanaObservedTransaction_networkId_signature_key" ON "SolanaObservedTransaction"("networkId", "signature");

-- CreateIndex
CREATE INDEX "SolanaSourceEvent_networkId_slot_signature_idx" ON "SolanaSourceEvent"("networkId", "slot", "signature");

-- CreateIndex
CREATE INDEX "SolanaSourceEvent_domainHash_slot_idx" ON "SolanaSourceEvent"("domainHash", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "SolanaSourceEvent_networkId_signature_instructionIndex_logI_key" ON "SolanaSourceEvent"("networkId", "signature", "instructionIndex", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayJob_sourceEventKey_key" ON "MultichainRelayJob"("sourceEventKey");

-- CreateIndex
CREATE INDEX "MultichainRelayJob_domainHash_globalDomainEpoch_originSeque_idx" ON "MultichainRelayJob"("domainHash", "globalDomainEpoch", "originSequence");

-- CreateIndex
CREATE INDEX "MultichainRelayJob_status_updatedAt_idx" ON "MultichainRelayJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayReorg_jobId_key" ON "MultichainRelayReorg"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayReorg_sourceEventKey_key" ON "MultichainRelayReorg"("sourceEventKey");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayReorg_auditHash_key" ON "MultichainRelayReorg"("auditHash");

-- CreateIndex
CREATE INDEX "MultichainRelayReorg_outcome_detectedAt_idx" ON "MultichainRelayReorg"("outcome", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayCompensation_destinationId_key" ON "MultichainRelayCompensation"("destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayCompensation_auditHash_key" ON "MultichainRelayCompensation"("auditHash");

-- CreateIndex
CREATE INDEX "MultichainRelayCompensation_status_createdAt_idx" ON "MultichainRelayCompensation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayCircuitBreaker_scopeKey_key" ON "MultichainRelayCircuitBreaker"("scopeKey");

-- CreateIndex
CREATE INDEX "MultichainRelayCircuitBreaker_status_updatedAt_idx" ON "MultichainRelayCircuitBreaker"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MultichainRelayCircuitBreaker_domainHash_status_idx" ON "MultichainRelayCircuitBreaker"("domainHash", "status");

-- CreateIndex
CREATE INDEX "MultichainRelayCircuitBreaker_networkId_registryId_status_idx" ON "MultichainRelayCircuitBreaker"("networkId", "registryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayCircuitEvent_auditHash_key" ON "MultichainRelayCircuitEvent"("auditHash");

-- CreateIndex
CREATE INDEX "MultichainRelayCircuitEvent_signalKind_createdAt_idx" ON "MultichainRelayCircuitEvent"("signalKind", "createdAt");

-- CreateIndex
CREATE INDEX "MultichainRelayCircuitEvent_resultingStatus_createdAt_idx" ON "MultichainRelayCircuitEvent"("resultingStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayCircuitEvent_breakerId_requestId_key" ON "MultichainRelayCircuitEvent"("breakerId", "requestId");

-- CreateIndex
CREATE INDEX "MultichainRelayDestination_status_updatedAt_idx" ON "MultichainRelayDestination"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelayDestination_jobId_destinationNetworkId_desti_key" ON "MultichainRelayDestination"("jobId", "destinationNetworkId", "destinationRegistryId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelaySubmission_destinationId_key" ON "MultichainRelaySubmission"("destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelaySubmission_idempotencyKey_key" ON "MultichainRelaySubmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MultichainRelaySubmission_status_nextAttemptAt_idx" ON "MultichainRelaySubmission"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MultichainRelaySubmission_leaseUntil_idx" ON "MultichainRelaySubmission"("leaseUntil");

-- CreateIndex
CREATE INDEX "MultichainRelaySubmissionAttempt_submissionId_createdAt_idx" ON "MultichainRelaySubmissionAttempt"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainRelaySubmissionAttempt_submissionId_attempt_outco_key" ON "MultichainRelaySubmissionAttempt"("submissionId", "attempt", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainReconciliationRun_requestId_key" ON "MultichainReconciliationRun"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainReconciliationRun_auditHash_key" ON "MultichainReconciliationRun"("auditHash");

-- CreateIndex
CREATE INDEX "MultichainReconciliationRun_domainHash_completedAt_idx" ON "MultichainReconciliationRun"("domainHash", "completedAt");

-- CreateIndex
CREATE INDEX "MultichainReconciliationRun_status_completedAt_idx" ON "MultichainReconciliationRun"("status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainReconciliationFinding_auditHash_key" ON "MultichainReconciliationFinding"("auditHash");

-- CreateIndex
CREATE INDEX "MultichainReconciliationFinding_kind_createdAt_idx" ON "MultichainReconciliationFinding"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "MultichainReconciliationFinding_destinationNetworkId_destin_idx" ON "MultichainReconciliationFinding"("destinationNetworkId", "destinationRegistryId");

-- CreateIndex
CREATE UNIQUE INDEX "MultichainReconciliationFinding_runId_destinationNetworkId__key" ON "MultichainReconciliationFinding"("runId", "destinationNetworkId", "destinationRegistryId");

-- CreateIndex
CREATE INDEX "MultichainRelayTransition_jobId_createdAt_idx" ON "MultichainRelayTransition"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "MultichainRelayTransition_destinationId_createdAt_idx" ON "MultichainRelayTransition"("destinationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OriginRecord_domainHash_key" ON "OriginRecord"("domainHash");

-- CreateIndex
CREATE INDEX "OriginRecord_originNetworkId_status_idx" ON "OriginRecord"("originNetworkId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OriginAuditEvent_ordinal_key" ON "OriginAuditEvent"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "OriginAuditEvent_eventHash_key" ON "OriginAuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "OriginAuditEvent_domainHash_createdAt_idx" ON "OriginAuditEvent"("domainHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OriginAuditEvent_domainHash_requestId_key" ON "OriginAuditEvent"("domainHash", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "OriginOutboxEvent_auditEventId_key" ON "OriginOutboxEvent"("auditEventId");

-- CreateIndex
CREATE INDEX "OriginOutboxEvent_status_availableAt_idx" ON "OriginOutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OriginOutboxEvent_partitionKey_createdAt_idx" ON "OriginOutboxEvent"("partitionKey", "createdAt");

-- CreateIndex
CREATE INDEX "OriginDnsChallenge_domainHash_status_expiresAt_idx" ON "OriginDnsChallenge"("domainHash", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "OriginDnsChallenge_requesterId_createdAt_idx" ON "OriginDnsChallenge"("requesterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservation_blockingDomainHash_key" ON "OriginReservation"("blockingDomainHash");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservation_dnsChallengeId_key" ON "OriginReservation"("dnsChallengeId");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservation_nonce_key" ON "OriginReservation"("nonce");

-- CreateIndex
CREATE INDEX "OriginReservation_domainHash_status_holdUntil_idx" ON "OriginReservation"("domainHash", "status", "holdUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservation_requesterId_idempotencyKeyHash_key" ON "OriginReservation"("requesterId", "idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "OriginClaimIssuance_reservationId_key" ON "OriginClaimIssuance"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "OriginClaimIssuance_digest_key" ON "OriginClaimIssuance"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "OriginClaimIssuance_nonce_key" ON "OriginClaimIssuance"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "OriginClaimIssuance_idempotencyKeyHash_key" ON "OriginClaimIssuance"("idempotencyKeyHash");

-- CreateIndex
CREATE INDEX "OriginClaimIssuance_domainHash_status_deadline_idx" ON "OriginClaimIssuance"("domainHash", "status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservationAuditEvent_ordinal_key" ON "OriginReservationAuditEvent"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservationAuditEvent_eventHash_key" ON "OriginReservationAuditEvent"("eventHash");

-- CreateIndex
CREATE INDEX "OriginReservationAuditEvent_domainHash_ordinal_idx" ON "OriginReservationAuditEvent"("domainHash", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservationAuditEvent_reservationId_requestId_key" ON "OriginReservationAuditEvent"("reservationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "OriginReservationOutboxEvent_auditEventId_key" ON "OriginReservationOutboxEvent"("auditEventId");

-- CreateIndex
CREATE INDEX "OriginReservationOutboxEvent_status_availableAt_idx" ON "OriginReservationOutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OriginReservationOutboxEvent_partitionKey_createdAt_idx" ON "OriginReservationOutboxEvent"("partitionKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reputation_domain_subIdentityId_key" ON "Reputation"("domain", "subIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domainName_key" ON "Domain"("domainName");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "WalletVault_domainId_key" ON "WalletVault"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "SmtpConfig_domainId_key" ON "SmtpConfig"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_localPart_domainId_key" ON "EmailAccount"("localPart", "domainId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_messageId_key" ON "Message"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateRoute_targetDomain_key" ON "PrivateRoute"("targetDomain");

-- CreateIndex
CREATE UNIQUE INDEX "StealthConfig_domainName_key" ON "StealthConfig"("domainName");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointPool_code_key" ON "EndpointPool"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DomainRouteRule_domainPattern_key" ON "DomainRouteRule"("domainPattern");

-- AddForeignKey
ALTER TABLE "EvmObservedBlock" ADD CONSTRAINT "EvmObservedBlock_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "EvmObserverCursor"("networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvmSourceEvent" ADD CONSTRAINT "EvmSourceEvent_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "EvmObserverCursor"("networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolanaObservedTransaction" ADD CONSTRAINT "SolanaObservedTransaction_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "SolanaObserverCursor"("networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolanaSourceEvent" ADD CONSTRAINT "SolanaSourceEvent_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "SolanaObserverCursor"("networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayReorg" ADD CONSTRAINT "MultichainRelayReorg_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MultichainRelayJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayCompensation" ADD CONSTRAINT "MultichainRelayCompensation_reorgId_fkey" FOREIGN KEY ("reorgId") REFERENCES "MultichainRelayReorg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayCompensation" ADD CONSTRAINT "MultichainRelayCompensation_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "MultichainRelayDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayCircuitEvent" ADD CONSTRAINT "MultichainRelayCircuitEvent_breakerId_fkey" FOREIGN KEY ("breakerId") REFERENCES "MultichainRelayCircuitBreaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayDestination" ADD CONSTRAINT "MultichainRelayDestination_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MultichainRelayJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelaySubmission" ADD CONSTRAINT "MultichainRelaySubmission_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "MultichainRelayDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelaySubmissionAttempt" ADD CONSTRAINT "MultichainRelaySubmissionAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "MultichainRelaySubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainReconciliationFinding" ADD CONSTRAINT "MultichainReconciliationFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MultichainReconciliationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayTransition" ADD CONSTRAINT "MultichainRelayTransition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MultichainRelayJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultichainRelayTransition" ADD CONSTRAINT "MultichainRelayTransition_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "MultichainRelayDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginAuditEvent" ADD CONSTRAINT "OriginAuditEvent_originRecordId_fkey" FOREIGN KEY ("originRecordId") REFERENCES "OriginRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginOutboxEvent" ADD CONSTRAINT "OriginOutboxEvent_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "OriginAuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginReservation" ADD CONSTRAINT "OriginReservation_dnsChallengeId_fkey" FOREIGN KEY ("dnsChallengeId") REFERENCES "OriginDnsChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginClaimIssuance" ADD CONSTRAINT "OriginClaimIssuance_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "OriginReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginReservationAuditEvent" ADD CONSTRAINT "OriginReservationAuditEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "OriginReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OriginReservationOutboxEvent" ADD CONSTRAINT "OriginReservationOutboxEvent_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "OriginReservationAuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletVault" ADD CONSTRAINT "WalletVault_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmtpConfig" ADD CONSTRAINT "SmtpConfig_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EndpointNode" ADD CONSTRAINT "EndpointNode_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "EndpointPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRouteRule" ADD CONSTRAINT "DomainRouteRule_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "EndpointPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
