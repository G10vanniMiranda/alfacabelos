import { after } from "next/server";
import { deliverPendingBookingNotifications } from "@/lib/notifications/service";
import { logger } from "@/lib/observability/logger";

/**
 * Sends a request's booking notices once the response is out. The booking transaction has
 * committed by then, so nothing can be sent for a booking that was rolled back.
 */
export function scheduleBookingNotificationDelivery(requestId: string): void {
  if (process.env.WHATSAPP_ENABLED !== "true" || !requestId) return;
  after(async () => {
    await deliverPendingBookingNotifications(requestId)
      .catch((error) => logger.error("notification.inline_delivery_batch_failed", { requestId, error }));
  });
}
