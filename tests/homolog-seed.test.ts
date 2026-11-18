import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { checkCriticalConfiguration } from "../lib/observability/health";
import { HOMOLOG_REF, PRODUCTION_REF, type Env } from "../scripts/homolog-migrate";
import {
  QA_AVAILABILITY,
  QA_BARBER,
  QA_CLIENT,
  parseSeedArgs,
  planSeed,
  runHomologSeed,
  validateSeedEnvironment,
  type ExistingState,
  type Fingerprint,
  type SeedCreate,
  type SeedDatabase,
  type SeedDependencies,
  type SeedOptions,
} from "../scripts/homolog-seed";

const HOST = "aws-0-sa-east-1.pooler.supabase.com";
const pooler = (port: number, query = "", user = `postgres.${HOMOLOG_REF}`) => `postgresql://${user}:pw-123@${HOST}:${port}/postgres${query}`;
const FILE_ENV: Record<string, string> = {
  APP_ENV: "homologation",
  HOMOLOGATION_LOCAL_HTTP: "true",
  APP_URL: "http://127.0.0.1:3100",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
  DATABASE_URL: pooler(6543, "?pgbouncer=true&connection_limit=1"),
  DIRECT_URL: pooler(5432),
  CRON_SECRET: "homolog-cron-secret-2026",
  SUPABASE_URL: `https://${HOMOLOG_REF}.supabase.co`,
  SUPABASE_PROJECT_REF: HOMOLOG_REF,
  SUPABASE_SERVICE_ROLE_KEY: "configured",
  SUPABASE_STORAGE_BUCKET: "barber-homolog",
  PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
  PRODUCTION_APP_HOST: "alfacabelos.vercel.app",
  PRODUCTION_STORAGE_BUCKET: "barber",
  WHATSAPP_ENABLED: "false",
};
const APPLY_SHELL: Env = {
  HOMOLOGATION_TARGET_CONFIRMED: "true",
  QA_SEED_CLIENT_PASSWORD: "client-pass-g31-xyz",
  QA_SEED_BARBER_PASSWORD: "barber-pass-g31-xyz",
};
const DRY: SeedOptions = { envFile: ".env", apply: false };
const APPLY: SeedOptions = { envFile: ".env", apply: true, confirm: HOMOLOG_REF };
const HOMOLOG_FINGERPRINT: Fingerprint = { database: "postgres", homologBucket: true, productionBucket: false, appliedMigrations: 22 };
const TOTAL_RECORDS = 4 + QA_AVAILABILITY.length;

const repoRoot = mkdtempSync(path.join(os.tmpdir(), "homolog-seed-"));
writeFileSync(path.join(repoRoot, ".env"), "");
after(() => rmSync(repoRoot, { recursive: true, force: true }));

const emptyState = (): ExistingState => ({
  barber: null, service: null, availability: [], client: null, foreignPhoneOwners: 0,
  access: null, foreignEmailOwners: 0, foreignBarberAccessOwners: 0,
});

/** In-memory database: a transaction works on a copy and commits only if `run` resolves (rollback otherwise). */
function fakeDatabase(initial: Partial<ExistingState> = {}, options: { fingerprint?: Partial<Fingerprint>; failOn?: SeedCreate["entity"] } = {}) {
  const calls = { opened: 0, transactions: [] as boolean[], readOnly: 0, creates: [] as SeedCreate[], hashes: [] as string[], disconnected: 0 };
  let committed: ExistingState = { ...emptyState(), ...initial };
  const open = (): SeedDatabase => {
    calls.opened += 1;
    return {
      async transaction(write, run) {
        calls.transactions.push(write);
        const working: ExistingState = structuredClone(committed);
        let readOnly = false;
        const result = await run({
          async setReadOnly() { readOnly = true; calls.readOnly += 1; },
          async fingerprint() { return { ...HOMOLOG_FINGERPRINT, ...options.fingerprint }; },
          async readExisting() { return structuredClone(working); },
          async create(operation, hashes) {
            if (readOnly) throw new Error("read_only_transaction");
            if (operation.entity === options.failOn) throw new Error("simulated_failure");
            calls.creates.push(operation);
            if (operation.entity === "barber") working.barber = { name: QA_BARBER.name, isActive: true };
            else if (operation.entity === "service") working.service = { name: "[QA] Corte Sintético", durationMinutes: 30, priceCents: 1000, isProcedure: false, isActive: true };
            else if (operation.entity === "availability") working.availability.push(operation.row);
            else if (operation.entity === "client") { working.client = { name: QA_CLIENT.name, phoneNormalized: QA_CLIENT.phoneNormalized, status: "ACTIVE" }; calls.hashes.push(hashes.client); }
            else { working.access = { email: "qa.barber.g31@example.invalid", role: "BARBER", barberId: QA_BARBER.id, isActive: true }; calls.hashes.push(hashes.barber); }
          },
        });
        committed = working;
        return result;
      },
      async disconnect() { calls.disconnected += 1; },
    };
  };
  return { open, calls, state: () => committed };
}

function deps(database: ReturnType<typeof fakeDatabase>, overrides: { fileEnv?: Record<string, string>; shellEnv?: Env } = {}) {
  const logs: string[] = [];
  const value: SeedDependencies = {
    repoRoot,
    shellEnv: overrides.shellEnv ?? {},
    readEnvFile: () => overrides.fileEnv ?? FILE_ENV,
    expectedMigrations: 22,
    openDatabase: database.open,
    checkConfiguration: checkCriticalConfiguration,
    hashPassword: async (password) => `hash(${password.length})`,
    log: (line) => logs.push(line),
  };
  return { value, logs };
}

const issuesOf = (fileEnv: Record<string, string>, shellEnv: Env = {}, options: SeedOptions = DRY) => {
  try {
    validateSeedEnvironment(fileEnv, shellEnv, options, checkCriticalConfiguration);
    return [];
  } catch (error) {
    return (error as Error).message.split(",");
  }
};

test("arguments default to dry-run and require an env file", () => {
  assert.deepEqual(parseSeedArgs(["--env-file=.env"]), { envFile: ".env", apply: false, confirm: undefined });
  assert.deepEqual(parseSeedArgs(["--env-file=.env", "--apply", `--confirm=${HOMOLOG_REF}`]), { envFile: ".env", apply: true, confirm: HOMOLOG_REF });
  for (const argv of [[], ["--apply"], ["--env-file=.env", "--confirm=x"], ["--env-file=.env", "--force"], ["--env-file=.env", "--apply=yes"]]) {
    assert.throws(() => parseSeedArgs(argv), argv.join(" "));
  }
});

test("environment guard accepts only the isolated homologation target", () => {
  assert.deepEqual(issuesOf(FILE_ENV), []);
  assert.deepEqual(issuesOf(FILE_ENV, APPLY_SHELL, APPLY), []);
  const rejected: Array<[string, Record<string, string>, Env?]> = [
    ["app_env", { ...FILE_ENV, APP_ENV: "production" }],
    ["app_env", { ...FILE_ENV, APP_ENV: "Homologation" }],
    ["supabase_project_ref", { ...FILE_ENV, SUPABASE_PROJECT_REF: PRODUCTION_REF }],
    ["DATABASE_URL:production_reference", { ...FILE_ENV, DATABASE_URL: pooler(6543, "?pgbouncer=true", `postgres.${PRODUCTION_REF}`) }],
    ["DIRECT_URL:user", { ...FILE_ENV, DIRECT_URL: pooler(5432, "", "postgres.otherprojectref0000") }],
    ["whatsapp_enabled", { ...FILE_ENV, WHATSAPP_ENABLED: "true" }],
    ["whatsapp_enabled", Object.fromEntries(Object.entries(FILE_ENV).filter(([key]) => key !== "WHATSAPP_ENABLED"))],
    ["vercel_runtime", FILE_ENV, { VERCEL_ENV: "preview" }],
    ["vercel_runtime", FILE_ENV, { VERCEL: "1" }],
    ["DATABASE_URL:shell_conflict", FILE_ENV, { DATABASE_URL: pooler(6543, "?pgbouncer=true", "postgres.otherprojectref0000") }],
    ["APP_ENV:shell_conflict", FILE_ENV, { APP_ENV: "production" }],
    ["SUPABASE_URL:production_reference", { ...FILE_ENV, SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }],
    ["storage_buckets", { ...FILE_ENV, SUPABASE_STORAGE_BUCKET: "barber" }],
    ["configuration:notification_worker_auth", { ...FILE_ENV, CRON_SECRET: "short" }],
    ["HOMOLOGATION_TARGET_CONFIRMED:in_env_file", { ...FILE_ENV, HOMOLOGATION_TARGET_CONFIRMED: "true" }],
    ["QA_SEED_CLIENT_PASSWORD:in_env_file", { ...FILE_ENV, QA_SEED_CLIENT_PASSWORD: "client-pass-g31-xyz" }],
  ];
  for (const [issue, fileEnv, shellEnv] of rejected) {
    assert.ok(issuesOf(fileEnv, shellEnv).includes(issue), issue);
  }
});

test("apply requires the typed homologation ref, shell confirmation and distinct strong passwords", () => {
  const cases: Array<[string, Env, SeedOptions]> = [
    ["confirm", APPLY_SHELL, { ...APPLY, confirm: undefined }],
    ["confirm", APPLY_SHELL, { ...APPLY, confirm: PRODUCTION_REF }],
    ["homologation_target_confirmation", { ...APPLY_SHELL, HOMOLOGATION_TARGET_CONFIRMED: "yes" }, APPLY],
    ["client_password", { ...APPLY_SHELL, QA_SEED_CLIENT_PASSWORD: "short" }, APPLY],
    ["barber_password", { ...APPLY_SHELL, QA_SEED_BARBER_PASSWORD: undefined }, APPLY],
    ["barber_password", { ...APPLY_SHELL, QA_SEED_BARBER_PASSWORD: " padded-password-1 " }, APPLY],
    ["passwords_reused", { ...APPLY_SHELL, QA_SEED_BARBER_PASSWORD: APPLY_SHELL.QA_SEED_CLIENT_PASSWORD }, APPLY],
  ];
  for (const [issue, shellEnv, options] of cases) {
    assert.ok(issuesOf(FILE_ENV, shellEnv, options).includes(issue), issue);
  }
});

test("an unsafe environment never opens a database connection", async () => {
  const database = fakeDatabase();
  const { value } = deps(database, { fileEnv: { ...FILE_ENV, SUPABASE_PROJECT_REF: PRODUCTION_REF } });
  await assert.rejects(runHomologSeed(DRY, value), /supabase_project_ref/);
  await assert.rejects(runHomologSeed({ envFile: "../outside.env", apply: false }, value), /env_file_outside_worktree/);
  assert.equal(database.calls.opened, 0);
});

test("dry-run plans every synthetic record inside a read-only transaction and writes nothing", async () => {
  const database = fakeDatabase();
  const { value, logs } = deps(database);
  assert.equal(await runHomologSeed(DRY, value), 0);
  assert.deepEqual(database.calls.transactions, [false]);
  assert.equal(database.calls.readOnly, 1);
  assert.equal(database.calls.creates.length, 0);
  assert.equal(database.calls.disconnected, 1);
  assert.equal(logs.filter((line) => line.startsWith("HOMOLOG_SEED_PLAN create")).length, TOTAL_RECORDS);
  assert.ok(logs.includes(`HOMOLOG_SEED_DRY_RUN ref=${HOMOLOG_REF} create=${TOTAL_RECORDS} unchanged=0 conflicts=0`));
});

test("the write connection must prove the homologation fingerprint before planning", async () => {
  for (const [fingerprint, issue] of [
    [{ productionBucket: true }, "production_bucket_present"],
    [{ homologBucket: false }, "homolog_bucket_missing"],
    [{ appliedMigrations: 21 }, "migrations"],
    [{ database: "other" }, "database"],
  ] as const) {
    const database = fakeDatabase({}, { fingerprint });
    const { value } = deps(database, { shellEnv: APPLY_SHELL });
    await assert.rejects(runHomologSeed(APPLY, value), new RegExp(`fingerprint:.*${issue}`));
    assert.equal(database.calls.creates.length, 0, issue);
    assert.equal(database.calls.disconnected, 1, issue);
  }
});

test("apply creates the synthetic set once and is idempotent on rerun", async () => {
  const database = fakeDatabase();
  const first = deps(database, { shellEnv: APPLY_SHELL });
  assert.equal(await runHomologSeed(APPLY, first.value), 0);
  assert.deepEqual(database.calls.transactions, [true]);
  assert.equal(database.calls.readOnly, 0);
  assert.equal(database.calls.creates.length, TOTAL_RECORDS);
  assert.deepEqual(database.calls.hashes, ["hash(19)", "hash(19)"]);
  assert.ok(first.logs.some((line) => line.startsWith(`HOMOLOG_SEED_VERIFIED create=0 unchanged=${TOTAL_RECORDS} conflicts=0`)));
  assert.doesNotMatch(first.logs.join("\n"), /client-pass|barber-pass|pw-123|postgresql:/);

  const second = deps(database, { shellEnv: APPLY_SHELL });
  assert.equal(await runHomologSeed(APPLY, second.value), 0);
  assert.equal(database.calls.creates.length, TOTAL_RECORDS);
  assert.ok(second.logs.includes(`HOMOLOG_SEED_APPLY ref=${HOMOLOG_REF} create=0 unchanged=${TOTAL_RECORDS} conflicts=0`));
});

test("records that are not exactly the QA fixtures block the run without writes", async () => {
  const cases: Array<[Partial<ExistingState>, string]> = [
    [{ foreignPhoneOwners: 1 }, "client:phone_in_use"],
    [{ client: { name: "Pessoa Real", phoneNormalized: QA_CLIENT.phoneNormalized, status: "ACTIVE" } }, "client:modified"],
    [{ barber: { name: QA_BARBER.name, isActive: false } }, "barber:modified"],
    [{ foreignEmailOwners: 1 }, "barber_access:email_in_use"],
    [{ foreignBarberAccessOwners: 1 }, "barber_access:barber_linked"],
  ];
  for (const [initial, conflict] of cases) {
    assert.ok(planSeed({ ...emptyState(), ...initial }).conflicts.includes(conflict), conflict);
    const database = fakeDatabase(initial);
    const { value, logs } = deps(database, { shellEnv: APPLY_SHELL });
    assert.equal(await runHomologSeed(APPLY, value), 2, conflict);
    assert.equal(database.calls.creates.length, 0, conflict);
    assert.ok(logs.includes(`HOMOLOG_SEED_CONFLICT ${conflict}`), conflict);
  }
});

test("a failure in the middle of apply rolls back every synthetic record", async () => {
  const database = fakeDatabase({}, { failOn: "client" });
  const { value } = deps(database, { shellEnv: APPLY_SHELL });
  await assert.rejects(runHomologSeed(APPLY, value), /simulated_failure/);
  assert.ok(database.calls.creates.length > 0);
  assert.deepEqual(database.state(), emptyState());
  assert.equal(database.calls.disconnected, 1);
});

test("seed source never deletes, updates, truncates or drops", () => {
  const source = readFileSync(path.join(__dirname, "../scripts/homolog-seed.ts"), "utf8");
  assert.doesNotMatch(source, /\.(delete|deleteMany|update|updateMany|upsert)\(|TRUNCATE|DROP\s|\$(execute|query)RawUnsafe|migrate (deploy|reset|dev)|db push/i);
});
