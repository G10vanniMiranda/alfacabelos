import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { parse } from "dotenv";
import { BUSINESS_CONFIG } from "@/lib/config";
import { normalizeBrazilPhone } from "@/lib/phone";
import {
  HOMOLOG_REF,
  HomologMigrateError,
  PRODUCTION_REF,
  resolveEnvFile,
  validateConnection,
  type Env,
} from "./homolog-migrate";

// Synthetic, homologation-only fixtures. Every record is identified by a stable `qa-g31-*` id
// or an RFC 2606 `.invalid` address; the phone uses DDD 20, which is not assigned in Brazil.
export const QA_BARBER = { id: "qa-g31-barber", name: "[QA] Barbeiro Sintético", isActive: true };
export const QA_SERVICE = {
  id: "qa-g31-service", name: "[QA] Corte Sintético", durationMinutes: 30, priceCents: 1000, isProcedure: false, isActive: true,
};
const QA_PHONE = normalizeBrazilPhone("(20) 90000-0031")!;
export const QA_CLIENT = {
  id: "qa-g31-client", name: "[QA] Cliente Sintético", phone: "(20) 90000-0031", phoneNormalized: QA_PHONE.national,
  status: "ACTIVE" as const, createdBy: "CLIENT" as const,
};
export const QA_BARBER_ACCESS = {
  id: "qa-g31-barber-access", email: "qa.barber.g31@example.invalid", role: "BARBER" as const, barberId: QA_BARBER.id, isActive: true,
};
export const QA_AVAILABILITY = BUSINESS_CONFIG.operatingHours.map((row) => ({
  barberId: QA_BARBER.id, dayOfWeek: row.dayOfWeek, openTime: row.open, closeTime: row.close,
}));
const MIN_PASSWORD_LENGTH = 12;

export class HomologSeedError extends Error {}

export type SeedOptions = { envFile: string; apply: boolean; confirm?: string };
export type Fingerprint = { database: string; homologBucket: boolean; productionBucket: boolean; appliedMigrations: number };
type Availability = (typeof QA_AVAILABILITY)[number];
export type ExistingState = {
  barber: { name: string; isActive: boolean } | null;
  service: { name: string; durationMinutes: number; priceCents: number; isProcedure: boolean; isActive: boolean } | null;
  availability: Availability[];
  client: { name: string; phoneNormalized: string; status: string } | null;
  foreignPhoneOwners: number;
  access: { email: string; role: string; barberId: string | null; isActive: boolean } | null;
  foreignEmailOwners: number;
  foreignBarberAccessOwners: number;
};
export type SeedCreate =
  | { entity: "barber" }
  | { entity: "service" }
  | { entity: "availability"; row: Availability }
  | { entity: "client" }
  | { entity: "barber_access" };
export type SeedPlan = { creates: SeedCreate[]; unchanged: string[]; conflicts: string[] };
export type SeedTx = {
  setReadOnly(): Promise<void>;
  fingerprint(buckets: { homolog: string; production: string }): Promise<Fingerprint>;
  readExisting(): Promise<ExistingState>;
  create(operation: SeedCreate, hashes: { client: string; barber: string }): Promise<void>;
};
export type SeedDatabase = {
  transaction<T>(write: boolean, run: (tx: SeedTx) => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
};
export type SeedDependencies = {
  repoRoot: string;
  shellEnv: Env;
  readEnvFile(file: string): Record<string, string>;
  expectedMigrations: number;
  openDatabase(databaseUrl: string): SeedDatabase;
  checkConfiguration(env: Env): { issues: string[] };
  hashPassword(password: string): Promise<string>;
  log(line: string): void;
};

export function parseSeedArgs(argv: string[]): SeedOptions {
  let envFile: string | undefined;
  let confirm: string | undefined;
  let apply = false;
  for (const arg of argv) {
    const separator = arg.indexOf("=");
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const value = separator === -1 ? undefined : arg.slice(separator + 1);
    if (name === "--apply" && value === undefined) apply = true;
    else if (name === "--env-file" && value) envFile = value;
    else if (name === "--confirm" && value) confirm = value;
    else throw new HomologSeedError("invalid_argument");
  }
  if (!envFile) throw new HomologSeedError("env_file_required");
  if (confirm !== undefined && !apply) throw new HomologSeedError("confirm_without_apply");
  return { envFile, apply, confirm };
}

const CRITICAL_SHELL_KEYS = ["APP_ENV", "SUPABASE_PROJECT_REF", "WHATSAPP_ENABLED", "SUPABASE_STORAGE_BUCKET", "PRODUCTION_STORAGE_BUCKET"];

/** Fail-closed target validation. Runs before any connection is opened. */
export function validateSeedEnvironment(
  fileEnv: Record<string, string>,
  shellEnv: Env,
  options: SeedOptions,
  checkConfiguration: SeedDependencies["checkConfiguration"],
) {
  const issues: string[] = [];
  if (fileEnv.APP_ENV !== "homologation") issues.push("app_env");
  if (fileEnv.SUPABASE_PROJECT_REF !== HOMOLOG_REF) issues.push("supabase_project_ref");
  if (fileEnv.WHATSAPP_ENABLED !== "false") issues.push("whatsapp_enabled");
  if (fileEnv.VERCEL_ENV !== undefined || shellEnv.VERCEL_ENV !== undefined || shellEnv.VERCEL !== undefined) issues.push("vercel_runtime");
  for (const key of ["HOMOLOGATION_TARGET_CONFIRMED", "QA_SEED_CLIENT_PASSWORD", "QA_SEED_BARBER_PASSWORD"]) {
    if (key in fileEnv) issues.push(`${key}:in_env_file`);
  }
  for (const key of CRITICAL_SHELL_KEYS) {
    if (shellEnv[key] !== undefined && shellEnv[key] !== fileEnv[key]) issues.push(`${key}:shell_conflict`);
  }
  for (const [key, value] of Object.entries(fileEnv)) {
    if (!key.startsWith("PRODUCTION_") && value.toLowerCase().includes(PRODUCTION_REF)) issues.push(`${key}:production_reference`);
  }
  const homologBucket = fileEnv.SUPABASE_STORAGE_BUCKET?.trim();
  const productionBucket = fileEnv.PRODUCTION_STORAGE_BUCKET?.trim();
  if (!homologBucket || !productionBucket || homologBucket === productionBucket) issues.push("storage_buckets");
  for (const issue of checkConfiguration(fileEnv).issues) issues.push(`configuration:${issue}`);
  let databaseUrl = "";
  try {
    databaseUrl = validateConnection(fileEnv, shellEnv).databaseUrl;
  } catch (error) {
    if (!(error instanceof HomologMigrateError)) throw error;
    issues.push(...error.message.split(","));
  }
  const passwords = options.apply ? validateApplyAuthorization(shellEnv, options, issues) : undefined;
  if (issues.length) throw new HomologSeedError([...new Set(issues)].sort((a, b) => a.localeCompare(b)).join(","));
  return { databaseUrl, buckets: { homolog: homologBucket!, production: productionBucket! }, passwords };
}

// Writes need the typed project ref, the shell confirmation and operator-supplied passwords (never read from the env file).
function validateApplyAuthorization(shellEnv: Env, options: SeedOptions, issues: string[]) {
  if (options.confirm !== HOMOLOG_REF) issues.push("confirm");
  if (shellEnv.HOMOLOGATION_TARGET_CONFIRMED !== "true") issues.push("homologation_target_confirmation");
  const client = shellEnv.QA_SEED_CLIENT_PASSWORD ?? "";
  const barber = shellEnv.QA_SEED_BARBER_PASSWORD ?? "";
  if (client.length < MIN_PASSWORD_LENGTH || client !== client.trim()) issues.push("client_password");
  if (barber.length < MIN_PASSWORD_LENGTH || barber !== barber.trim()) issues.push("barber_password");
  if (client && client === barber) issues.push("passwords_reused");
  return { client, barber };
}

/** The write connection itself must prove it is the homologation project. */
export function verifyFingerprint(fingerprint: Fingerprint, expectedMigrations: number): void {
  const issues: string[] = [];
  if (fingerprint.database !== "postgres") issues.push("database");
  if (!fingerprint.homologBucket) issues.push("homolog_bucket_missing");
  if (fingerprint.productionBucket) issues.push("production_bucket_present");
  if (fingerprint.appliedMigrations !== expectedMigrations) issues.push("migrations");
  if (issues.length) throw new HomologSeedError(`fingerprint:${issues.join(",")}`);
}

const sameAvailability = (a: Availability, b: Availability) =>
  a.barberId === b.barberId && a.dayOfWeek === b.dayOfWeek && a.openTime === b.openTime && a.closeTime === b.closeTime;

/** Creates only what is missing; never updates. Any record that is not exactly ours is a conflict. */
export function planSeed(existing: ExistingState): SeedPlan {
  const plan: SeedPlan = { creates: [], unchanged: [], conflicts: [] };
  const check = (entity: string, current: object | null, expected: Record<string, unknown>, create: SeedCreate) => {
    if (!current) plan.creates.push(create);
    else if (Object.entries(expected).every(([key, value]) => (current as Record<string, unknown>)[key] === value)) plan.unchanged.push(entity);
    else plan.conflicts.push(`${entity}:modified`);
  };
  check("barber", existing.barber, { name: QA_BARBER.name, isActive: QA_BARBER.isActive }, { entity: "barber" });
  check("service", existing.service, {
    name: QA_SERVICE.name, durationMinutes: QA_SERVICE.durationMinutes, priceCents: QA_SERVICE.priceCents,
    isProcedure: QA_SERVICE.isProcedure, isActive: QA_SERVICE.isActive,
  }, { entity: "service" });
  for (const row of QA_AVAILABILITY) {
    if (existing.availability.some((current) => sameAvailability(current, row))) plan.unchanged.push(`availability:${row.dayOfWeek}:${row.openTime}`);
    else plan.creates.push({ entity: "availability", row });
  }
  if (existing.foreignPhoneOwners > 0) plan.conflicts.push("client:phone_in_use");
  check("client", existing.client, {
    name: QA_CLIENT.name, phoneNormalized: QA_CLIENT.phoneNormalized, status: QA_CLIENT.status,
  }, { entity: "client" });
  if (existing.foreignEmailOwners > 0) plan.conflicts.push("barber_access:email_in_use");
  if (existing.foreignBarberAccessOwners > 0) plan.conflicts.push("barber_access:barber_linked");
  check("barber_access", existing.access, {
    email: QA_BARBER_ACCESS.email, role: QA_BARBER_ACCESS.role, barberId: QA_BARBER_ACCESS.barberId, isActive: QA_BARBER_ACCESS.isActive,
  }, { entity: "barber_access" });
  return plan;
}

function summarize(plan: SeedPlan): string {
  return `create=${plan.creates.length} unchanged=${plan.unchanged.length} conflicts=${plan.conflicts.length}`;
}

export async function runHomologSeed(options: SeedOptions, deps: SeedDependencies): Promise<number> {
  const envFile = resolveEnvFile(options.envFile, deps.repoRoot);
  const target = validateSeedEnvironment(deps.readEnvFile(envFile), deps.shellEnv, options, deps.checkConfiguration);
  const hashes = target.passwords
    ? { client: await deps.hashPassword(target.passwords.client), barber: await deps.hashPassword(target.passwords.barber) }
    : undefined;
  const database = deps.openDatabase(target.databaseUrl);
  try {
    const result = await database.transaction(options.apply, async (tx) => {
      if (!options.apply) await tx.setReadOnly();
      verifyFingerprint(await tx.fingerprint(target.buckets), deps.expectedMigrations);
      const plan = planSeed(await tx.readExisting());
      for (const item of plan.creates) deps.log(`HOMOLOG_SEED_PLAN create ${item.entity}${item.entity === "availability" ? ` day=${item.row.dayOfWeek} ${item.row.openTime}-${item.row.closeTime}` : ""}`);
      for (const conflict of plan.conflicts) deps.log(`HOMOLOG_SEED_CONFLICT ${conflict}`);
      if (!options.apply || plan.conflicts.length) return { plan, verified: null };
      for (const item of plan.creates) await tx.create(item, hashes!);
      const after = planSeed(await tx.readExisting());
      if (after.creates.length || after.conflicts.length) throw new HomologSeedError("verification_failed");
      return { plan, verified: after };
    });
    deps.log(`HOMOLOG_SEED_${options.apply ? "APPLY" : "DRY_RUN"} ref=${HOMOLOG_REF} ${summarize(result.plan)}`);
    if (result.plan.conflicts.length) return 2;
    if (result.verified) deps.log(`HOMOLOG_SEED_VERIFIED ${summarize(result.verified)} ids=${[QA_BARBER.id, QA_SERVICE.id, QA_CLIENT.id, QA_BARBER_ACCESS.id].join(",")}`);
    return 0;
  } finally {
    await database.disconnect();
  }
}

export function prismaSeedDatabase(databaseUrl: string): SeedDatabase {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  const adapter = (tx: Prisma.TransactionClient): SeedTx => ({
    async setReadOnly() {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    },
    async fingerprint(buckets) {
      const rows = await tx.$queryRaw<Fingerprint[]>`
        SELECT current_database() AS "database",
          EXISTS (SELECT 1 FROM storage.buckets WHERE name = ${buckets.homolog}) AS "homologBucket",
          EXISTS (SELECT 1 FROM storage.buckets WHERE name = ${buckets.production}) AS "productionBucket",
          (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS "appliedMigrations"`;
      if (rows.length !== 1) throw new HomologSeedError("fingerprint:unavailable");
      return rows[0];
    },
    async readExisting() {
      const phones = [QA_PHONE.national, QA_PHONE.e164];
      return {
        barber: await tx.barber.findUnique({ where: { id: QA_BARBER.id }, select: { name: true, isActive: true } }),
        service: await tx.service.findUnique({
          where: { id: QA_SERVICE.id },
          select: { name: true, durationMinutes: true, priceCents: true, isProcedure: true, isActive: true },
        }),
        availability: await tx.barberAvailability.findMany({
          where: { barberId: QA_BARBER.id }, select: { barberId: true, dayOfWeek: true, openTime: true, closeTime: true },
        }),
        client: await tx.client.findUnique({ where: { id: QA_CLIENT.id }, select: { name: true, phoneNormalized: true, status: true } }),
        foreignPhoneOwners: await tx.client.count({ where: { phoneNormalized: { in: phones }, id: { not: QA_CLIENT.id } } }),
        access: await tx.adminAccess.findUnique({
          where: { id: QA_BARBER_ACCESS.id }, select: { email: true, role: true, barberId: true, isActive: true },
        }),
        foreignEmailOwners: await tx.adminAccess.count({ where: { email: QA_BARBER_ACCESS.email, id: { not: QA_BARBER_ACCESS.id } } }),
        foreignBarberAccessOwners: await tx.adminAccess.count({ where: { barberId: QA_BARBER.id, id: { not: QA_BARBER_ACCESS.id } } }),
      };
    },
    async create(operation, hashes) {
      if (operation.entity === "barber") await tx.barber.create({ data: QA_BARBER });
      else if (operation.entity === "service") await tx.service.create({ data: QA_SERVICE });
      else if (operation.entity === "availability") await tx.barberAvailability.create({ data: operation.row });
      else if (operation.entity === "client") await tx.client.create({ data: { ...QA_CLIENT, passwordHash: hashes.client, hasPassword: true } });
      else await tx.adminAccess.create({ data: { ...QA_BARBER_ACCESS, passwordHash: hashes.barber } });
    },
  });
  return {
    transaction: (write, run) => prisma.$transaction((tx) => run(adapter(tx)), {
      maxWait: 10_000, timeout: 30_000,
      isolationLevel: write ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead,
    }),
    disconnect: () => prisma.$disconnect(),
  };
}

export function countLocalMigrations(repoRoot: string): number {
  return readdirSync(path.join(repoRoot, "prisma", "migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Snapshot the real shell first: constructing a PrismaClient loads `.env` into process.env,
  // which would let file values pass as shell confirmations. App modules are imported only afterwards.
  const shellEnv: Env = { ...process.env };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  Promise.resolve().then(async () => {
    const options = parseSeedArgs(process.argv.slice(2));
    const [{ checkCriticalConfiguration }, { hashClientPassword }] = await Promise.all([
      import("@/lib/observability/health"),
      import("@/lib/auth/client-store"),
    ]);
    return runHomologSeed(options, {
      repoRoot,
      shellEnv,
      readEnvFile: (file) => parse(readFileSync(file)),
      expectedMigrations: countLocalMigrations(repoRoot),
      openDatabase: prismaSeedDatabase,
      checkConfiguration: checkCriticalConfiguration,
      hashPassword: hashClientPassword,
      log: (line) => console.log(line),
    });
  }).then((code) => { process.exitCode = code; }, (error) => {
    // Only codes: driver and URL errors may carry connection details.
    const code = error instanceof HomologSeedError || error instanceof HomologMigrateError
      ? error.message
      : error instanceof Prisma.PrismaClientKnownRequestError ? `prisma_${error.code}` : "unexpected_error";
    console.error(`HOMOLOG_SEED_BLOCKED ${code}`);
    process.exitCode = 1;
  });
}
