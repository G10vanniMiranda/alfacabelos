import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { retryPendingNotifications } from "@/lib/notifications/service";

const limit = Number(process.argv[2] ?? 25);

retryPendingNotifications(Number.isFinite(limit) ? limit : 25)
  .then((results) => {
    const totals = results.reduce<Record<string, number>>((summary, result) => {
      summary[result.status] = (summary[result.status] ?? 0) + 1;
      return summary;
    }, {});
    console.info("[notifications-retry]", JSON.stringify({ processed: results.length, totals }));
  })
  .catch((error) => {
    console.error("[notifications-retry] failed", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
