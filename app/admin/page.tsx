import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AdminLogin } from "@/components/admin/admin-login";
import { SiteHeader } from "@/components/ui/site-header";
import { isAdminAuthenticated } from "@/lib/actions/booking-actions";
import { listAdminBookings, listBarbers, listBlockedSlots } from "@/lib/booking-service";

export const metadata = {
  title: "Admin | ALFA Barber",
};

export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();

  return (
    <div className="min-h-screen pb-10">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {!authenticated ? (
          <AdminLogin />
        ) : (
          <AdminDashboard
            bookings={await listAdminBookings({})}
            barbers={await listBarbers()}
            blockedSlots={await listBlockedSlots()}
          />
        )}
      </main>
    </div>
  );
}

