export type AlertSeverity = "warning" | "critical";
export type OperationalAlert = { code: string; severity: AlertSeverity; value: number | string | null; threshold: number; };

export type AlertInputs = {
  backlog: number;
  oldestPendingAgeSeconds: number | null;
  newDead24h: number;
  workerAgeSeconds: number | null;
  databaseLatencyMs: number | null;
};

function threshold(name: string, fallback: number, min = 1): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

export function evaluateOperationalAlerts(input: AlertInputs): OperationalAlert[] {
  const backlogLimit = threshold("ALERT_OUTBOX_BACKLOG", 50);
  const oldestLimit = threshold("ALERT_OUTBOX_OLDEST_SECONDS", 15 * 60);
  const workerLimit = threshold("ALERT_WORKER_STALE_SECONDS", 15 * 60);
  const databaseLimit = threshold("ALERT_DATABASE_LATENCY_MS", 500);
  const alerts: OperationalAlert[] = [];
  if (input.backlog > backlogLimit) alerts.push({ code: "outbox.backlog", severity: "warning", value: input.backlog, threshold: backlogLimit });
  if (input.oldestPendingAgeSeconds !== null && input.oldestPendingAgeSeconds > oldestLimit) {
    alerts.push({ code: "outbox.oldest_pending", severity: "critical", value: input.oldestPendingAgeSeconds, threshold: oldestLimit });
  }
  if (input.newDead24h > 0) alerts.push({ code: "outbox.new_dead", severity: "critical", value: input.newDead24h, threshold: 0 });
  if (input.workerAgeSeconds === null || input.workerAgeSeconds > workerLimit) {
    alerts.push({ code: "worker.stale", severity: "critical", value: input.workerAgeSeconds, threshold: workerLimit });
  }
  if (input.databaseLatencyMs === null || input.databaseLatencyMs > databaseLimit) {
    alerts.push({ code: "database.latency", severity: "critical", value: input.databaseLatencyMs, threshold: databaseLimit });
  }
  return alerts;
}
