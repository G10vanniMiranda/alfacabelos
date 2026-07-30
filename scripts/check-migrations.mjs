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

if (errors.length) {
  console.error("Falhas nas migrations:\n" + errors.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`${entries.length} migrations verificadas.`);
