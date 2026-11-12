-- Additive only: a new table for one-time recovery code challenges.
-- PasswordResetToken is untouched so links issued before this release keep
-- working until they expire (30 min), with no new privileges.
-- Rollback (only while no code depends on it): DROP TABLE "PasswordResetChallenge";

BEGIN;

-- CreateTable
CREATE TABLE "PasswordResetChallenge" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "handleHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetChallenge_handleHash_key" ON "PasswordResetChallenge"("handleHash");

-- CreateIndex
CREATE INDEX "PasswordResetChallenge_clientId_createdAt_idx" ON "PasswordResetChallenge"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetChallenge_expiresAt_idx" ON "PasswordResetChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "PasswordResetChallenge" ADD CONSTRAINT "PasswordResetChallenge_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same posture as every application table: backend-only through Prisma.
ALTER TABLE "PasswordResetChallenge" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "PasswordResetChallenge" FROM anon, authenticated;

COMMIT;
