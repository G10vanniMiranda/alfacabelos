-- These tables are backend-only. Enabling RLS without public policies denies
-- access through Supabase PostgREST while preserving the direct Prisma role.
ALTER TABLE "ClientSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityRateLimitEvent" ENABLE ROW LEVEL SECURITY;
