import "dotenv/config";
import { pathToFileURL } from "node:url";

export type TestEnvironmentClassification = {
  safe: boolean;
  environment: string;
  host: string;
  database: string;
  reasons: string[];
};

export function classifyTestEnvironment(env: NodeJS.ProcessEnv = process.env): TestEnvironmentClassification {
  const environment = (env.APP_ENV || env.VERCEL_ENV || env.NODE_ENV || "unknown").toLowerCase();
  const reasons: string[] = [];
  let host = "invalid";
  let database = "invalid";
  try {
    const url = new URL(env.DIRECT_URL || env.DATABASE_URL || "");
    host = url.hostname.toLowerCase();
    database = url.pathname.replace(/^\//, "").toLowerCase();
  } catch {
    reasons.push("database URL ausente ou inválida");
  }

  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal";
  const disposableName = /(?:^|[_-])(ci|test|qa|homolog|ephemeral|disposable)(?:$|[_-])/.test(database);
  if (!localHost) reasons.push("host do banco não é local");
  if (!disposableName) reasons.push("nome do banco não indica ambiente descartável");
  if (["production", "prod"].includes(environment)) reasons.push("ambiente explicitamente de produção");
  if (env.ALLOW_DESTRUCTIVE_TESTS !== "true") reasons.push("ALLOW_DESTRUCTIVE_TESTS não está confirmado");

  return { safe: reasons.length === 0, environment, host, database, reasons };
}

export function assertSafeTestEnvironment(env: NodeJS.ProcessEnv = process.env): TestEnvironmentClassification {
  const result = classifyTestEnvironment(env);
  if (!result.safe) {
    throw new Error(`GUARD_BLOCKED: ${result.reasons.join("; ")} (environment=${result.environment}, host=${result.host}, database=${result.database})`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = assertSafeTestEnvironment();
    console.log(`SAFE_TEST_ENV environment=${result.environment} host=${result.host} database=${result.database}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "GUARD_BLOCKED");
    process.exitCode = 1;
  }
}
