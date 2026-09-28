import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("prisma", "migrations");
const entries = readdirSync(root)
  .filter((name) => statSync(path.join(root, name)).isDirectory())
  .sort();
const timestamps = new Set();
const errors = [];

for (const directory of entries) {
  const match = /^(\d{14})_[a-z0-9_]+$/.exec(directory);
  if (!match) {
    errors.push(`${directory}: nome fora do padrão AAAAMMDDHHMMSS_descricao`);
    continue;
  }
  if (timestamps.has(match[1])) errors.push(`${directory}: timestamp duplicado`);
  timestamps.add(match[1]);

  const sqlPath = path.join(root, directory, "migration.sql");
  let sql;
  try {
    sql = readFileSync(sqlPath, "utf8");
  } catch {
    errors.push(`${directory}: migration.sql ausente`);
    continue;
  }
  if (!sql.trim()) errors.push(`${directory}: migration.sql vazio`);
  if (/^(<{7}|={7}|>{7})/m.test(sql)) errors.push(`${directory}: marcador de conflito Git`);
  if (/\bDROP\s+(DATABASE|SCHEMA\s+public)\b/i.test(sql)) errors.push(`${directory}: operação destrutiva proibida`);
}

const privilegeMigration = entries.find((name) => name.endsWith("_lock_down_future_public_privileges"));
if (!privilegeMigration) {
  errors.push("migration de privilégios padrão futuros ausente");
} else {
  const sql = readFileSync(path.join(root, privilegeMigration, "migration.sql"), "utf8");
  for (const objectType of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
    if (!new RegExp(`ALTER DEFAULT PRIVILEGES[\\s\\S]*?ON ${objectType}[\\s\\S]*?anon[\\s\\S]*?authenticated`, "i").test(sql)) {
      errors.push(`${privilegeMigration}: revogação futura incompleta para ${objectType}`);
    }
  }
  if (/\bFROM\b[^;]*\bservice_role\b/i.test(sql)) {
    errors.push(`${privilegeMigration}: service_role não deve ser revogada`);
  }
}

const outboxMigration = entries.find((name) => name.endsWith("_harden_notification_outbox"));
if (!outboxMigration) {
  errors.push("migration de endurecimento do outbox ausente");
} else {
  const sql = readFileSync(path.join(root, outboxMigration, "migration.sql"), "utf8");
  if (!/WHEN\s+'SENT'\s+THEN\s+'SENT'[\s\S]*?ELSE\s+'DEAD'/i.test(sql)) {
    errors.push(`${outboxMigration}: legado nao enviado deve ser quarentenado como DEAD`);
  }
  if (/WHEN\s+'(?:PENDING|FAILED|NOT_CONFIGURED|SENDING)'\s+THEN\s+'(?:PENDING|RETRY|PROCESSING)'/i.test(sql)) {
    errors.push(`${outboxMigration}: legado nao enviado nao pode ficar automaticamente elegivel`);
  }
  const eligibleColumn = /ADD COLUMN IF NOT EXISTS\s+"eligibleAt"\s+([^,;]+)/i.exec(sql)?.[1] ?? "";
  if (!/TIMESTAMP\(3\)/i.test(eligibleColumn) || /NOT NULL|DEFAULT/i.test(eligibleColumn)) {
    errors.push(`${outboxMigration}: eligibleAt deve ser anulÃ¡vel e sem default no banco`);
  }
  if (!/"eligibleAt"\s*=\s*NULL/i.test(sql)) {
    errors.push(`${outboxMigration}: linhas historicas devem iniciar com eligibleAt NULL`);
  }
  if (!/^\s*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql)) {
    errors.push(`${outboxMigration}: migration critica deve ser explicitamente transacional`);
  }
}

const observabilityMigration = entries.find((name) => name.endsWith("_add_operational_observability"));
if (!observabilityMigration) {
  errors.push("migration de observabilidade operacional ausente");
} else {
  const sql = readFileSync(path.join(root, observabilityMigration, "migration.sql"), "utf8");
  if (!/^\s*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql)) {
    errors.push(`${observabilityMigration}: migration critica deve ser explicitamente transacional`);
  }
}

const notificationServicePath = path.resolve("lib", "notifications", "service.ts");
let notificationService = "";
try {
  notificationService = readFileSync(notificationServicePath, "utf8");
} catch {
  errors.push("lib/notifications/service.ts ausente");
}
const claimPredicate = /WITH\s+candidates\s+AS\s*\([\s\S]*?\bWHERE\b([\s\S]*?)\bORDER\s+BY\b/i.exec(notificationService)?.[1] ?? "";
if (notificationService && !claimPredicate) {
  errors.push("worker do outbox: bloco de predicado do claim ausente");
}
if (claimPredicate && !/\$\{eligibility\}/.test(claimPredicate)) {
  errors.push("worker do outbox: claim deve reutilizar a politica canonica de elegibilidade");
}

const claimPolicyPath = path.resolve("lib", "notifications", "claim-policy.ts");
let claimPolicy = "";
try {
  claimPolicy = readFileSync(claimPolicyPath, "utf8");
} catch {
  errors.push("lib/notifications/claim-policy.ts ausente");
}
for (const [label, pattern] of [
  ["status PENDING/RETRY", /"status"\s+IN\s+\('PENDING',\s*'RETRY'\)/i],
  ["eligibleAt presente", /"eligibleAt"\s+IS\s+NOT\s+NULL/i],
  ["eligibleAt vencido", /"eligibleAt"\s*<=/i],
  ["limite de tentativas", /"attempts"\s*</i],
  ["backoff vencido", /"nextRetryAt"\s+IS\s+NULL[\s\S]*?"nextRetryAt"\s*<=/i],
]) {
  if (claimPolicy && !pattern.test(claimPolicy)) {
    errors.push(`worker do outbox: predicado obrigatorio ausente (${label})`);
  }
}

const metricsPath = path.resolve("lib", "observability", "metrics.ts");
let metricsSource = "";
try {
  metricsSource = readFileSync(metricsPath, "utf8");
} catch {
  errors.push("lib/observability/metrics.ts ausente");
}
if (metricsSource && !/COUNT\(\*\)\s+FILTER\s*\(WHERE\s+\$\{eligibility\}\)[\s\S]*?AS\s+"eligibleNow"/i.test(metricsSource)) {
  errors.push("metricas do outbox: eligibleNow deve reutilizar a politica canonica de claim");
}

if (errors.length) {
  console.error("Falhas nas migrations:\n" + errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`${entries.length} migrations verificadas.`);
