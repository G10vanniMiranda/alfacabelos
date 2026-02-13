import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin/admin-login";
import { isAdminAuthenticated } from "@/lib/actions/booking-actions";

export const metadata = {
  title: "Admin | ALFA Barber",
};

export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();
  if (authenticated) {
    redirect("/admin/servicos");
  }

  return (
    <div className="min-h-screen pb-10">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <AdminLogin />
      </main>
    </div>
  );
}

