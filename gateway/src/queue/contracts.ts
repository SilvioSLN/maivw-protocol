import type { RetryPolicy } from "./types.js";

export const STANDARD_QUEUES = {
  MAIL_SEND: "mail:send",
  ORACLE_DISPUTE: "oracle:dispute",
  RELAYER_MIRROR: "relayer:mirror",
} as const;

export type StandardQueueName = typeof STANDARD_QUEUES[keyof typeof STANDARD_QUEUES];

export const QUEUE_ROLE_OWNERS: Readonly<Record<StandardQueueName, string>> = {
  [STANDARD_QUEUES.MAIL_SEND]: "mail-worker",
  [STANDARD_QUEUES.ORACLE_DISPUTE]: "oracle-worker",
  [STANDARD_QUEUES.RELAYER_MIRROR]: "relayer-worker",
};

export const DEFAULT_QUEUE_POLICIES: Readonly<Record<StandardQueueName, RetryPolicy>> = {
  [STANDARD_QUEUES.MAIL_SEND]: {
    maxAttempts: 3,
    backoff: { type: "exponential", delayMs: 1000 },
  },
  [STANDARD_QUEUES.ORACLE_DISPUTE]: {
    maxAttempts: 3,
    backoff: { type: "exponential", delayMs: 1000 },
  },
  [STANDARD_QUEUES.RELAYER_MIRROR]: {
    maxAttempts: 20,
    backoff: { type: "fixed", delayMs: 15000 },
  },
};

export interface MailSendJobData {
  messageId: string;
  senderDomain: string;
  recipient: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  subIdentityId?: string;
  metadata?: Record<string, unknown>;
}

export interface OracleDisputeJobData {
  disputeId: string;
  senderDomain: string;
  reporterAddress: string;
  subIdentityId?: string;
  payload: Record<string, unknown>;
}

export interface RelayerMirrorJobData {
  jobId: string;
  domain: string;
  operation: "REGISTER" | "SYNC" | "REVOKE";
  originNetworkId: string;
  destinationNetworkId: string;
  sourceTxId: string;
  globalDomainEpoch?: string;
  originSequence?: string;
}
/** v1 durable reference. Legacy payload-only jobs must be quarantined, never acknowledged as success. */
export interface RuntimeOperationJobData { version: 1; operationId: string; }
