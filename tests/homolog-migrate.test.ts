import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  HOMOLOG_REF,
  PRODUCTION_REF,
  buildChildEnv,
  classifyStatus,
  parseArgs,
  prismaCommand,
  redact,
  runHomologMigrate,
  validateConnection,
  classifyDrift,
  type Dependencies,
  type Env,
  type PrismaRun,
} from "../scripts/homolog-migrate";

const HOST = "aws-0-sa-east-1.pooler.supabase.com";
const PASSWORD = "s3cr3t-Pw%23";
const url = (port: number, options: { user?: string; password?: string; host?: string; query?: string } = {}) =>
  `postgresql://${options.user ?? `postgres.${HOMOLOG_REF}`}${options.password === "" ? "" : `:${options.password ?? PASSWORD}`}@${options.host ?? HOST}:${port}/postgres${options.query ?? ""}`;
const VALID = { DATABASE_URL: url(6543, { query: "?pgbouncer=true&connection_limit=1" }), DIRECT_URL: url(5432) };
const TARGET_LINE = `Datasource "db": PostgreSQL database "postgres", schema "public" at "${HOST}:5432"`;
const PENDING = `Prisma schema loaded from prisma\\schema.prisma\r\n${TARGET_LINE}\r\n\r\n2 migrations found in prisma/migrations\r\nFollowing migrations have not yet been applied:\r\n20260101000000_init\r\n20260102000000_next\r\n\r\nTo apply migrations in production run prisma migrate deploy.`;
const UP_TO_DATE = `${TARGET_LINE}\n\n2 migrations found in prisma/migrations\n\nDatabase schema is up to date!`;
const FAILED = `${TARGET_LINE}\n\nFollowing migration have failed:\n20260101000000_init\n\nThe failed migration(s) can be marked as rolled back or applied`;
const DIVERGED = `${TARGET_LINE}\n\nYour local migration history and the migrations table from your database are different:\n\nThe last common migration is: 20260101000000_init`;

const issues = (fileEnv: Record<string, string>, shellEnv: Env = {}) => {
  try {
    validateConnection(fileEnv, shellEnv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

function harness(outputs: PrismaRun[], options: { fileEnv?: Record<string, string>; shellEnv?: Env } = {}) {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "homolog-migrate-"));
  const fileEnv = options.fileEnv ?? VALID;
  writeFileSync(path.join(repoRoot, ".env"), Object.entries(fileEnv).map(([key, value]) => `${key}="${value}"`).join("\n"));
  const calls: Array<{ args: string[]; env: Env }> = [];
  const logs: string[] = [];
  const deps: Dependencies = {
    repoRoot,
    shellEnv: options.shellEnv ?? { Path: "C:\\Windows", SystemRoot: "C:\\Windows" },
    runPrisma: (args, env) => {
      calls.push({ args, env });
      const next = outputs.shift();
      assert.ok(next, `unexpected prisma call: ${args.join(" ")}`);
      return next;
    },
    log: (line) => logs.push(line),
  };
  return { deps, calls, logs, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

const blocked = (fn: () => unknown) => {
  try {
    fn();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

test("accepts the pinned homologation pooler identity", () => {
  const connection = validateConnection(VALID, {});
  assert.equal(connection.host, HOST);
  assert.ok(connection.secrets.includes("s3cr3t-Pw#"));
});

test("rejects any production reference before parsing", () => {
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { user: `postgres.${PRODUCTION_REF}` }) }), /DIRECT_URL:production_reference/);
  assert.match(issues({ ...VALID, DATABASE_URL: url(6543, { host: `db.${PRODUCTION_REF}.supabase.co` }) }), /DATABASE_URL:production_reference/);
});

test("rejects wrong host, user, port, database and other Supabase projects", () => {
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { host: `db.${HOMOLOG_REF}.supabase.co` }) }), /DIRECT_URL:host/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { host: "aws-0-us-east-1.pooler.supabase.com" }) }), /DIRECT_URL:host/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { user: "postgres" }) }), /DIRECT_URL:user/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(6543) }), /DIRECT_URL:port/);
  assert.match(issues({ ...VALID, DATABASE_URL: url(5432) }), /DATABASE_URL:port/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432).replace(/\/postgres$/, "/other") }), /DIRECT_URL:database/);
  assert.match(issues({ ...VALID, DATABASE_URL: url(6543, { user: "postgres.abcdefghijklmnopqrst" }) }), /DATABASE_URL:user/);
  assert.match(issues({ ...VALID, DATABASE_URL: url(6543, { host: "aws-1-sa-east-1.pooler.supabase.com" }) }), /host_mismatch/);
});

test("rejects missing password, placeholders, missing variables and redirecting query parameters", () => {
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { password: "" }) }), /DIRECT_URL:password_missing/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { password: "[YOUR-PASSWORD]" }) }), /DIRECT_URL:placeholder/);
  assert.match(issues({ DATABASE_URL: VALID.DATABASE_URL }), /DIRECT_URL:missing/);
  assert.match(issues({ ...VALID, DIRECT_URL: "not a url" }), /DIRECT_URL:invalid_url/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { query: "?host=/tmp" }) }), /DIRECT_URL:query_parameter/);
  assert.match(issues({ ...VALID, DIRECT_URL: url(5432, { query: "?schema=other" }) }), /DIRECT_URL:query_parameter/);
});

test("rejects a conflicting shell variable even when the file is valid", () => {
  assert.match(issues(VALID, { DIRECT_URL: url(5432, { password: "other" }) }), /DIRECT_URL:shell_conflict/);
  assert.equal(issues(VALID, { DIRECT_URL: VALID.DIRECT_URL }), "");
});

test("does not depend on APP_URL, CRON_SECRET, service role or PRODUCTION_* baselines", () => {
  assert.equal(issues({ ...VALID, PRODUCTION_SUPABASE_PROJECT_REF: "wrong", PRODUCTION_APP_HOST: "" }), "");
});

test("accepts only status and deploy with known flags", () => {
  assert.deepEqual(parseArgs(["status", "--env-file", ".env"]), { operation: "status", envFile: ".env" });
  assert.deepEqual(parseArgs(["deploy", "--env-file=.env", `--confirm=${HOMOLOG_REF}`]), { operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF });
  for (const argv of [["reset"], ["migrate", "dev"], ["db", "push"], ["db", "seed"], ["db", "execute"], []]) {
    assert.equal(blocked(() => parseArgs(argv)), "operation_not_allowed");
  }
  assert.equal(blocked(() => parseArgs(["status", "--env-file", ".env", "--force"])), "argument_value_missing:--force");
  assert.equal(blocked(() => parseArgs(["status", "--env-file", ".env", "--schema", "x"])), "argument_not_allowed");
  assert.equal(blocked(() => parseArgs(["status", "--env-file", ".env", "--confirm", HOMOLOG_REF])), "argument_not_allowed");
  assert.equal(blocked(() => parseArgs(["status", "--env-file", ".env", "--env-file", "other"])), "argument_not_allowed");
  assert.equal(blocked(() => parseArgs(["status"])), "env_file_required");
});

test("rejects an env file from another worktree or directory", () => {
  const { deps, calls, cleanup } = harness([]);
  try {
    const outside = path.join(path.dirname(deps.repoRoot), "alfa-cabelos", ".env");
    assert.equal(blocked(() => runHomologMigrate({ operation: "status", envFile: outside }, deps)), "env_file_outside_worktree");
    assert.equal(blocked(() => runHomologMigrate({ operation: "status", envFile: "../.env" }, deps)), "env_file_outside_worktree");
    assert.equal(blocked(() => runHomologMigrate({ operation: "status", envFile: "missing.env" }, deps)), "env_file_missing");
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test("child environment keeps only operational variables and the validated URLs", () => {
  const connection = validateConnection(VALID, {});
  const env = buildChildEnv(
    { Path: "C:\\Windows", SystemRoot: "C:\\Windows", NODE_OPTIONS: "--require evil", PGHOST: "prod", DOTENV_CONFIG_OVERRIDE: "true", PRISMA_SCHEMA_ENGINE_BINARY: "x", SUPABASE_SERVICE_ROLE_KEY: "k" },
    connection,
    "C:\\repo\\.env",
  );
  assert.deepEqual(Object.keys(env).sort(), ["CHECKPOINT_DISABLE", "DATABASE_URL", "DIRECT_URL", "DOTENV_CONFIG_PATH", "DOTENV_CONFIG_QUIET", "PRISMA_HIDE_UPDATE_MESSAGE", "Path", "SystemRoot"]);
  assert.equal(env.DIRECT_URL, VALID.DIRECT_URL);
  assert.equal(env.DOTENV_CONFIG_PATH, "C:\\repo\\.env");
});

test("prisma runs through the node binary without a shell and without URLs in argv", () => {
  const command = prismaCommand(process.cwd(), ["migrate", "status"]);
  assert.equal(command.command, process.execPath);
  assert.equal(command.options.shell, false);
  assert.match(command.args[0], /prisma[\\/]build[\\/]index\.js$/);
  assert.deepEqual(command.args.slice(1), ["migrate", "status"]);
  assert.ok(!command.args.some((arg) => arg.includes("postgres")));
});

test("redacts credentials from subprocess output", () => {
  const connection = validateConnection(VALID, {});
  const output = redact(`at ${VALID.DIRECT_URL} password s3cr3t-Pw# and s3cr3t-Pw%23 and mysql://a:b@c`, connection.secrets);
  assert.ok(!output.includes("s3cr3t"));
  assert.ok(!output.includes(`postgres.${HOMOLOG_REF}:`));
  assert.match(output, /mysql:\/\/\*\*\*@c/);
});

test("classifies Prisma 6 status output by content, not by exit code", () => {
  assert.deepEqual(classifyStatus(PENDING), { state: "pending", pending: 2, target: `${HOST}:5432` });
  assert.equal(classifyStatus(UP_TO_DATE).state, "up_to_date");
  assert.equal(classifyStatus(FAILED).state, "failed");
  assert.equal(classifyStatus(DIVERGED).state, "diverged");
  assert.equal(classifyStatus("Error: P1001: Can't reach database server").state, "error");
  assert.equal(classifyStatus("unexpected").state, "error");
});

test("status runs only `migrate status` and reports pending migrations with exit 0", () => {
  const { deps, calls, logs, cleanup } = harness([{ status: 1, output: PENDING }]);
  try {
    assert.equal(runHomologMigrate({ operation: "status", envFile: ".env" }, deps), 0);
    assert.deepEqual(calls.map((call) => call.args), [["migrate", "status"]]);
    assert.equal(calls[0].env.DIRECT_URL, VALID.DIRECT_URL);
    assert.ok(logs.includes(`HOMOLOG_MIGRATE_STATUS ref=${HOMOLOG_REF} state=pending pending=2 target=${HOST}:5432`));
    assert.ok(!logs.join("\n").includes("s3cr3t"));
  } finally {
    cleanup();
  }
});

test("status fails closed when Prisma reports a different target or cannot connect", () => {
  const mismatch = harness([{ status: 0, output: UP_TO_DATE.replace(`${HOST}:5432`, `${HOST}:6543`) }]);
  const offline = harness([{ status: 1, output: "Error: P1001: Can't reach database server" }]);
  try {
    assert.equal(blocked(() => runHomologMigrate({ operation: "status", envFile: ".env" }, mismatch.deps)), "target_mismatch");
    assert.equal(runHomologMigrate({ operation: "status", envFile: ".env" }, offline.deps), 1);
  } finally {
    mismatch.cleanup();
    offline.cleanup();
  }
});

test("deploy requires typed project confirmation and HOMOLOGATION_TARGET_CONFIRMED before any subprocess", () => {
  const { deps, calls, cleanup } = harness([]);
  try {
    assert.equal(blocked(() => runHomologMigrate({ operation: "deploy", envFile: ".env" }, deps)), "deploy_confirmation_missing");
    assert.equal(blocked(() => runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: PRODUCTION_REF }, deps)), "deploy_confirmation_missing");
    assert.equal(blocked(() => runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF }, deps)), "homologation_target_confirmation_missing");
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

const confirmed = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", HOMOLOGATION_TARGET_CONFIRMED: "true" };

test("simulated deploy runs status, deploy, status and drift check in order", () => {
  const { deps, calls, logs, cleanup } = harness(
    [{ status: 1, output: PENDING }, { status: 0, output: "All migrations have been successfully applied." }, { status: 0, output: UP_TO_DATE }, { status: 0, output: "No difference detected." }],
    { shellEnv: confirmed },
  );
  try {
    assert.equal(runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF }, deps), 0);
    assert.deepEqual(calls.map((call) => call.args.slice(0, 2).join(" ")), ["migrate status", "migrate deploy", "migrate status", "migrate diff"]);
    assert.ok(!calls.some((call) => "HOMOLOGATION_TARGET_CONFIRMED" in call.env));
    assert.ok(logs.includes("HOMOLOG_MIGRATE_DRIFT none"));
  } finally {
    cleanup();
  }
});

test("deploy refuses failed or diverged history without calling migrate deploy", () => {
  for (const output of [FAILED, DIVERGED]) {
    const { deps, calls, cleanup } = harness([{ status: 1, output }], { shellEnv: confirmed });
    try {
      assert.equal(runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF }, deps), 2);
      assert.equal(calls.length, 1);
    } finally {
      cleanup();
    }
  }
});

test("deploy preserves subprocess failure codes and reports drift", () => {
  const failing = harness([{ status: 1, output: PENDING }, { status: 1, output: "Error: P3018 migration failed" }], { shellEnv: confirmed });
  const drifting = harness([{ status: 1, output: PENDING }, { status: 0, output: "" }, { status: 0, output: UP_TO_DATE }, { status: 2, output: "[+] Added tables" }], { shellEnv: confirmed });
  try {
    assert.equal(runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF }, failing.deps), 1);
    assert.equal(failing.calls.length, 2);
    assert.equal(runHomologMigrate({ operation: "deploy", envFile: ".env", confirm: HOMOLOG_REF }, drifting.deps), 2);
    assert.ok(drifting.logs.includes("HOMOLOG_MIGRATE_DRIFT detected"));
  } finally {
    failing.cleanup();
    drifting.cleanup();
  }
});

// Real Prisma 6.19.3 `migrate diff --exit-code` outputs captured offline.
const NO_DRIFT = "Loaded Prisma config from prisma.config.ts.\n\nPrisma config detected, skipping environment variable loading.\nNo difference detected.";
const DRIFT = "[*] Changed the `Booking` table\n  [*] Altered column `updatedAt` (default changed from `Some(Now)` to `None`)";
const OFFLINE = "Error: P1001\n\nCan't reach database server at `aws-0-sa-east-1.pooler.supabase.com:5432`";
const driftOnly = { operation: "drift" as const, envFile: ".env" };

test("classifies drift output fail-closed", () => {
  assert.equal(classifyDrift({ status: 0, output: NO_DRIFT }), "none");
  assert.equal(classifyDrift({ status: 2, output: DRIFT }), "detected");
  assert.equal(classifyDrift({ status: 1, output: OFFLINE }), "connection_error");
  assert.equal(classifyDrift({ status: 2, output: `${DRIFT}\nError: P1017 Server has closed the connection` }), "connection_error");
  assert.equal(classifyDrift({ status: 0, output: "" }), "unexpected_output");
  assert.equal(classifyDrift({ status: 2, output: "changed somehow" }), "unexpected_output");
  assert.equal(classifyDrift({ status: 1, output: "Error: P3006 something else" }), "unexpected_output");
});

test("drift is read-only: status proof then diff, no confirmation, no deploy, no URL in argv", () => {
  const { deps, calls, logs, cleanup } = harness([{ status: 0, output: UP_TO_DATE }, { status: 0, output: NO_DRIFT }]);
  try {
    assert.equal(deps.shellEnv.HOMOLOGATION_TARGET_CONFIRMED, undefined);
    assert.equal(runHomologMigrate(driftOnly, deps), 0);
    assert.deepEqual(calls.map((call) => call.args), [
      ["migrate", "status"],
      ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
    ]);
    assert.ok(!calls.some((call) => call.args.some((arg) => /deploy|reset|push|execute|postgres/.test(arg))));
    assert.equal(calls[1].env.DIRECT_URL, VALID.DIRECT_URL);
    assert.ok(logs.includes("HOMOLOG_MIGRATE_DRIFT none"));
  } finally {
    cleanup();
  }
});

test("drift propagates detected, connection and unexpected results as exit codes", () => {
  const cases: Array<[PrismaRun[], number, string, number]> = [
    [[{ status: 0, output: UP_TO_DATE }, { status: 2, output: DRIFT }], 2, "detected", 2],
    [[{ status: 0, output: UP_TO_DATE }, { status: 1, output: OFFLINE }], 1, "connection_error", 2],
    [[{ status: 1, output: OFFLINE }], 1, "connection_error", 1],
    [[{ status: 1, output: "garbage" }], 1, "unexpected_output", 1],
    [[{ status: 0, output: UP_TO_DATE }, { status: 0, output: "" }], 1, "unexpected_output", 2],
  ];
  for (const [outputs, code, result, callCount] of cases) {
    const { deps, calls, logs, cleanup } = harness(outputs);
    try {
      assert.equal(runHomologMigrate(driftOnly, deps), code, result);
      assert.ok(logs.includes(`HOMOLOG_MIGRATE_DRIFT ${result}`), result);
      assert.equal(calls.length, callCount, result);
    } finally {
      cleanup();
    }
  }
});

test("drift reports unsafe targets without running the diff", () => {
  const forbidden = harness([], { fileEnv: { ...VALID, DIRECT_URL: url(5432, { user: `postgres.${PRODUCTION_REF}` }) } });
  const mismatch = harness([{ status: 0, output: UP_TO_DATE.replace(`${HOST}:5432`, `${HOST}:6543`) }]);
  try {
    assert.equal(runHomologMigrate(driftOnly, forbidden.deps), 1);
    assert.equal(forbidden.calls.length, 0);
    assert.ok(forbidden.logs.includes("HOMOLOG_MIGRATE_DRIFT unsafe_target issues=DIRECT_URL:production_reference"));
    assert.equal(runHomologMigrate(driftOnly, mismatch.deps), 1);
    assert.equal(mismatch.calls.length, 1);
    assert.ok(mismatch.logs.includes("HOMOLOG_MIGRATE_DRIFT unsafe_target issues=target_mismatch"));
  } finally {
    forbidden.cleanup();
    mismatch.cleanup();
  }
});

test("drift accepts only --env-file and redacts credentials from Prisma output", () => {
  assert.deepEqual(parseArgs(["drift", "--env-file", ".env"]), { operation: "drift", envFile: ".env" });
  assert.equal(blocked(() => parseArgs(["drift", "--env-file", ".env", "--confirm", HOMOLOG_REF])), "argument_not_allowed");
  assert.equal(blocked(() => parseArgs(["drift", "--env-file", ".env", "--from-url", "x"])), "argument_not_allowed");
  const { deps, logs, cleanup } = harness([{ status: 0, output: UP_TO_DATE }, { status: 1, output: `${OFFLINE} using ${VALID.DIRECT_URL} s3cr3t-Pw#` }]);
  try {
    assert.equal(runHomologMigrate(driftOnly, deps), 1);
    assert.ok(!logs.join("\n").includes("s3cr3t"));
  } finally {
    cleanup();
  }
});
