import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { isAdminAuthenticated } from "@/lib/actions/booking-actions";

export default async function AdminPanelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/admin");
  }

  return (
    <div className="min-h-screen pb-10">
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[260px_1fr] lg:items-start">
          <AdminSidebar />
          {children}
        </div>
      </main>
    </div>
  );
}
