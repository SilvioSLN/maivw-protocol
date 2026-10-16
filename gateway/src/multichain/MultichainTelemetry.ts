export interface TelemetryLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface MultichainCorrelation {
  domainHash?: string;
  originClaimId?: string;
  jobId?: string;
  networkId?: string;
  transaction?: { family: "EVM" | "SOLANA"; id: string };
  drift?: string;
}

const SECRET_KEY = /(?:authorization|cookie|password|secret|private.?key|keypair|signed.?payload|token)$/i;

export function redactTelemetry(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactTelemetry(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, redactTelemetry(item, childKey)]));
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function labels(input: Record<string, string | undefined>): string {
  return Object.entries(input).filter(([, value]) => value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join(",");
}

/** Low-cardinality metrics plus structured correlation logs with mandatory redaction. */
export class MultichainTelemetry {
  private readonly counters = new Map<string, number>();
  constructor(private readonly logger: TelemetryLogger, private readonly clock: () => Date = () => new Date()) {}

  record(
    event: string,
    correlation: MultichainCorrelation,
    details: Record<string, unknown> = {},
    level: "info" | "warn" | "error" = "info",
  ): void {
    const family = correlation.transaction?.family;
    const metricKey = `multichain_events_total{${labels({ event, family, drift: correlation.drift })}}`;
    this.counters.set(metricKey, (this.counters.get(metricKey) ?? 0) + 1);
    const payload = redactTelemetry({
      component: "multichain", event, occurredAt: this.clock().toISOString(),
      correlation, details,
    }) as Record<string, unknown>;
    this.logger[level](payload, event);
  }

  snapshot() {
    return {
      generatedAt: this.clock().toISOString(),
      counters: [...this.counters.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([metric, value]) => ({ metric, value })),
    };
  }
}
