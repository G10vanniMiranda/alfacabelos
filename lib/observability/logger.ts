type LogLevel = "debug" | "info" | "warn" | "error";
type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|cookie|api[-_]?key|service[-_]?role|dsn|credential)/i;
const PHONE_KEY = /(phone|telefone|recipient)/i;
const PII_KEY = /^(customerName|clientName|email|observations|message|payload)$/i;

export function maskLogPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 4 ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}` : "****";
}

function sanitizeString(value: string, freeformPii = false): string {
  const sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/)[^\s@]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|secret|key)=)[^&\s]+/gi, "$1[REDACTED]");
  return (freeformPii ? sanitized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_REDACTED]")
    .replace(/(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]*\d{4}(?!\d)/g, "[PHONE_REDACTED]")
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, "[TOKEN_REDACTED]")
    : sanitized).slice(0, 1000);
}

export function sanitizeLogValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (PII_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return PHONE_KEY.test(key) ? maskLogPhone(value) : sanitizeString(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message, true) };
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item, key, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, childValue]) => [childKey, sanitizeLogValue(childValue, childKey, depth + 1)]));
  }
  return sanitizeString(String(value));
}

function sanitizeAuditValue(value: unknown, key = "", depth = 0): unknown {
  if (PII_KEY.test(key)) return undefined;
  if (depth >= 4 || value === null || value === undefined || typeof value !== "object" || value instanceof Date || value instanceof Error) {
    return sanitizeLogValue(value, key, depth);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditValue(item, key, depth + 1)).filter((item) => item !== undefined);
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .slice(0, 100)
    .filter(([childKey]) => !PII_KEY.test(childKey))
    .map(([childKey, childValue]) => [childKey, sanitizeAuditValue(childValue, childKey, depth + 1)]));
}

export function sanitizeAuditMetadata(metadata: LogFields | undefined): LogFields | undefined {
  return metadata ? sanitizeAuditValue(metadata) as LogFields : undefined;
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  const safeFields = sanitizeLogValue(fields);
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(safeFields && typeof safeFields === "object" && !Array.isArray(safeFields) ? safeFields : {}),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => {
    if (process.env.OBSERVABILITY_DEBUG === "true") write("debug", event, fields);
  },
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
