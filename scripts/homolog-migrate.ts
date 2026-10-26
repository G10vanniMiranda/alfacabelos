import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "dotenv";

// Fail-closed Prisma Migrate wrapper for the isolated ALFA homologation database only.
// Identity is pinned in code on purpose: PRODUCTION_* env baselines must not be able to weaken it.
export const HOMOLOG_REF = "hyrqxnbclwwpzheatwed";
export const PRODUCTION_REF = "fcjmntkcbenjpctjllvi";

const CONNECTION_KEYS = ["DATABASE_URL", "DIRECT_URL"] as const;
type ConnectionKey = (typeof CONNECTION_KEYS)[number];
// DATABASE_URL = Supavisor transaction mode, DIRECT_URL = session mode (what Prisma Migrate uses).
const EXPECTED_PORT: Record<ConnectionKey, string> = { DATABASE_URL: "6543", DIRECT_URL: "5432" };
const POOLER_HOST = /^aws-\d+-sa-east-1\.pooler\.supabase\.com$/;
// Anything else (e.g. `host`, `schema`) could silently redirect the target.
const ALLOWED_QUERY_PARAMETERS = new Set(["pgbouncer", "connection_limit", "pool_timeout", "connect_timeout", "sslmode"]);
const PLACEHOLDER = /[<>[\]{}]|your|change|password|xxx|\.\.\./i;
// Operating-system variables a Node/Prisma child needs on Windows and POSIX; compared case-insensitively.
const OPERATIONAL_VARIABLES = new Set([
  "path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp", "tmpdir", "home", "userprofile",
  "appdata", "localappdata", "programdata", "os", "processor_architecture", "number_of_processors", "lang",
]);
// Read-only: compares the live DIRECT_URL schema with the datamodel; the URL comes from env, never argv.
const DRIFT_ARGS = ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"];
// P1000-P1017: authentication, reachability, timeout and access errors.
const CONNECTION_ERROR = /\bP10\d{2}\b/;

export type Env = Partial<NodeJS.ProcessEnv>;
export type Operation = "status" | "deploy" | "drift";
export type DriftResult = "none" | "detected" | "connection_error" | "unexpected_output";
const DRIFT_EXIT: Record<DriftResult, number> = { none: 0, detected: 2, connection_error: 1, unexpected_output: 1 };
export type CliOptions = { operation: Operation; envFile: string; confirm?: string };
export type Connection = { host: string; databaseUrl: string; directUrl: string; secrets: string[] };
export type StatusState = "up_to_date" | "pending" | "failed" | "diverged" | "error";
export type StatusResult = { state: StatusState; pending: number; target: string | null };
export type PrismaRun = { status: number; output: string };
export type Dependencies = {
  repoRoot: string;
  shellEnv: Env;
  runPrisma: (args: string[], env: Env) => PrismaRun;
  log: (line: string) => void;
};

export class HomologMigrateError extends Error {}

export function parseArgs(argv: string[]): CliOptions {
  const [operation, ...rest] = argv;
  if (operation !== "status" && operation !== "deploy" && operation !== "drift") throw new HomologMigrateError("operation_not_allowed");
  const options: Partial<CliOptions> = { operation };
  for (let index = 0; index < rest.length; index += 1) {
    const separator = rest[index].indexOf("=");
    const flag = separator === -1 ? rest[index] : rest[index].slice(0, separator);
    const value = separator === -1 ? rest[++index] : rest[index].slice(separator + 1);
    if (value === undefined || value.startsWith("--")) throw new HomologMigrateError(`argument_value_missing:${flag}`);
    if (flag === "--env-file" && options.envFile === undefined) options.envFile = value;
    else if (flag === "--confirm" && options.confirm === undefined && operation === "deploy") options.confirm = value;
    else throw new HomologMigrateError("argument_not_allowed");
  }
  if (!options.envFile) throw new HomologMigrateError("env_file_required");
  return options as CliOptions;
}

export function resolveEnvFile(file: string, repoRoot: string): string {
  const absolute = path.resolve(repoRoot, file);
  const relative = path.relative(path.resolve(repoRoot), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new HomologMigrateError("env_file_outside_worktree");
  if (!existsSync(absolute)) throw new HomologMigrateError("env_file_missing");
  return absolute;
}

export function validateConnection(fileEnv: Record<string, string>, shellEnv: Env): Connection {
  const issues: string[] = [];
  const hosts = new Set<string>();
  const secrets: string[] = [];
  for (const key of CONNECTION_KEYS) {
    const raw = fileEnv[key]?.trim();
    if (!raw) { issues.push(`${key}:missing`); continue; }
    if (shellEnv[key] !== undefined && shellEnv[key] !== raw) issues.push(`${key}:shell_conflict`);
    if (raw.toLowerCase().includes(PRODUCTION_REF)) { issues.push(`${key}:production_reference`); continue; }
    if (PLACEHOLDER.test(raw)) { issues.push(`${key}:placeholder`); continue; }
    let url: URL;
    try { url = new URL(raw); } catch { issues.push(`${key}:invalid_url`); continue; }
    secrets.push(raw);
    if (url.password) secrets.push(url.password, decodeURIComponent(url.password));
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") issues.push(`${key}:protocol`);
    if (decodeURIComponent(url.username) !== `postgres.${HOMOLOG_REF}`) issues.push(`${key}:user`);
    if (!url.password) issues.push(`${key}:password_missing`);
    if (!POOLER_HOST.test(url.hostname)) issues.push(`${key}:host`);
    if (url.port !== EXPECTED_PORT[key]) issues.push(`${key}:port`);
    if (url.pathname !== "/postgres") issues.push(`${key}:database`);
    if ([...url.searchParams.keys()].some((name) => !ALLOWED_QUERY_PARAMETERS.has(name))) issues.push(`${key}:query_parameter`);
    hosts.add(url.hostname);
  }
  if (hosts.size > 1) issues.push("host_mismatch");
  if (issues.length) throw new HomologMigrateError(issues.sort().join(","));
  return { host: [...hosts][0], databaseUrl: fileEnv.DATABASE_URL.trim(), directUrl: fileEnv.DIRECT_URL.trim(), secrets };
}

export function buildChildEnv(shellEnv: Env, connection: Connection, envFile: string): Env {
  const env: Env = {};
  for (const [name, value] of Object.entries(shellEnv)) {
    if (value !== undefined && OPERATIONAL_VARIABLES.has(name.toLowerCase())) env[name] = value;
  }
  return {
    ...env,
    DATABASE_URL: connection.databaseUrl,
    DIRECT_URL: connection.directUrl,
    // prisma.config.ts runs `dotenv/config`; pin it to the validated file. dotenv never overrides the URLs above.
    DOTENV_CONFIG_PATH: envFile,
    DOTENV_CONFIG_QUIET: "true",
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };
}

export function redact(text: string, secrets: string[]): string {
  let result = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@");
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) result = result.split(secret).join("***");
  }
  return result;
}

export function classifyStatus(output: string): StatusResult {
  const target = /Datasource "db": .* at "([^"]+)"/.exec(output)?.[1] ?? null;
  if (/\bP\d{4}\b/.test(output)) return { state: "error", pending: 0, target };
  if (/have failed|failed migration/i.test(output)) return { state: "failed", pending: 0, target };
  if (/are different|not found locally|last common migration/i.test(output)) return { state: "diverged", pending: 0, target };
  if (/Database schema is up to date/i.test(output)) return { state: "up_to_date", pending: 0, target };
  const pendingBlock = /not yet been applied:\s*\r?\n([\s\S]*?)(?:\r?\n\s*\r?\n|$)/i.exec(output)?.[1];
  if (pendingBlock !== undefined) {
    const pending = pendingBlock.split(/\r?\n/).filter((line) => /^\s*\d{14}_[A-Za-z0-9_]+\s*$/.test(line)).length;
    return { state: pending ? "pending" : "error", pending, target };
  }
  return { state: "error", pending: 0, target };
}

export function classifyDrift(run: PrismaRun): DriftResult {
  if (CONNECTION_ERROR.test(run.output)) return "connection_error";
  if (run.status === 0 && /No difference detected\./.test(run.output)) return "none";
  if (run.status === 2 && /^[ \t]*\[[+*-]\]/m.test(run.output)) return "detected";
  return "unexpected_output";
}

export function prismaCommand(repoRoot: string, args: string[]) {
  const cli = createRequire(path.join(repoRoot, "package.json")).resolve("prisma/build/index.js");
  // Run the CLI through the current node binary: no shell, no npx/.cmd shims, URLs only via env.
  return { command: process.execPath, args: [cli, ...args], options: { cwd: repoRoot, shell: false, windowsHide: true, encoding: "utf8" as const, timeout: 300_000 } };
}

export function spawnPrisma(repoRoot: string) {
  return (args: string[], env: Env): PrismaRun => {
    const { command, args: argv, options } = prismaCommand(repoRoot, args);
    const result = spawnSync(command, argv, { ...options, env: env as NodeJS.ProcessEnv });
    if (result.error) return { status: 1, output: "subprocess_failed" };
    return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
}

export function runHomologMigrate(options: CliOptions, deps: Dependencies): number {
  if (options.operation !== "drift") return execute(options, deps);
  try {
    return execute(options, deps);
  } catch (error) {
    if (!(error instanceof HomologMigrateError)) throw error;
    // Validation or target-proof failure: the messages are issue codes only, never values.
    deps.log(`HOMOLOG_MIGRATE_DRIFT unsafe_target issues=${error.message}`);
    return 1;
  }
}

function execute(options: CliOptions, deps: Dependencies): number {
  const envFile = resolveEnvFile(options.envFile, deps.repoRoot);
  const connection = validateConnection(parse(readFileSync(envFile)), deps.shellEnv);
  if (options.operation === "deploy") {
    if (options.confirm !== HOMOLOG_REF) throw new HomologMigrateError("deploy_confirmation_missing");
    if (deps.shellEnv.HOMOLOGATION_TARGET_CONFIRMED !== "true") throw new HomologMigrateError("homologation_target_confirmation_missing");
  }
  const env = buildChildEnv(deps.shellEnv, connection, envFile);
  const expectedTarget = `${connection.host}:${EXPECTED_PORT.DIRECT_URL}`;

  const prisma = (args: string[]) => {
    const result = deps.runPrisma(args, env);
    deps.log(redact(result.output.trim(), connection.secrets));
    return result;
  };
  const status = () => {
    const { output } = prisma(["migrate", "status"]);
    const result = classifyStatus(output);
    // Proves which URL the Prisma process really used, independently of the validation above.
    if (result.state !== "error" && result.target !== expectedTarget) throw new HomologMigrateError("target_mismatch");
    deps.log(`HOMOLOG_MIGRATE_STATUS ref=${HOMOLOG_REF} state=${result.state} pending=${result.pending} target=${result.target ?? "unknown"}`);
    return { ...result, connectionError: CONNECTION_ERROR.test(output) };
  };
  const drift = (): number => {
    const result = classifyDrift(prisma(DRIFT_ARGS));
    deps.log(`HOMOLOG_MIGRATE_DRIFT ${result}`);
    return DRIFT_EXIT[result];
  };

  const before = status();
  if (options.operation === "status") return before.state === "error" ? 1 : before.state === "up_to_date" || before.state === "pending" ? 0 : 2;
  if (options.operation === "drift") {
    // `migrate diff` prints no datasource line, so the preceding status run is the target proof.
    if (before.state !== "error") return drift();
    deps.log(`HOMOLOG_MIGRATE_DRIFT ${before.connectionError ? "connection_error" : "unexpected_output"}`);
    return 1;
  }
  if (before.state === "up_to_date") return drift();
  if (before.state !== "pending") {
    deps.log(`HOMOLOG_MIGRATE_BLOCKED deploy_refused state=${before.state}`);
    return before.state === "error" ? 1 : 2;
  }
  const deployed = prisma(["migrate", "deploy"]);
  if (deployed.status !== 0) {
    deps.log(`HOMOLOG_MIGRATE_DEPLOY_FAILED exit=${deployed.status}`);
    return deployed.status;
  }
  const after = status();
  if (after.state !== "up_to_date") return after.state === "error" ? 1 : 2;
  return drift();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.exitCode = runHomologMigrate(parseArgs(process.argv.slice(2)), {
      repoRoot, shellEnv: process.env, runPrisma: spawnPrisma(repoRoot), log: (line) => console.log(line),
    });
  } catch (error) {
    // Only codes: messages from URL/dotenv parsing could carry credentials.
    console.error(`HOMOLOG_MIGRATE_BLOCKED ${error instanceof HomologMigrateError ? error.message : "unexpected_error"}`);
    process.exitCode = 1;
  }
}
