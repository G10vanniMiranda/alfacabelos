import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { processNotificationBatch } from "@/lib/notifications/service";
import { enqueueDueBookingReminders } from "@/lib/notifications/booking-intents";

const limit = Number(process.argv[2] ?? 25);

enqueueDueBookingReminders()
  .then(async (remindersEnqueued) => ({ remindersEnqueued, summary: await processNotificationBatch({ batchSize: Number.isFinite(limit) ? limit : 25 }) }))
  .then(async ({ remindersEnqueued, summary }) => {
    console.info("[notifications-process]", JSON.stringify({ ...summary, remindersEnqueued }));
  })
  .catch((error) => {
    console.error("[notifications-process] failed", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
