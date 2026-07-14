import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { isAdminAuthenticated } from "@/lib/actions/booking-actions";

export default async function AdminPanelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/admin?reason=session-expired");
  }

  return (
    <div className="min-h-screen overflow-x-clip pb-10">
      <ToastProvider>
        <main id="conteudo" className="mx-auto max-w-7xl overflow-x-clip px-3 py-4 sm:px-6 sm:py-8">
          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
            <AdminSidebar />
            <div className="min-w-0">
              {children}
            </div>
          </div>
        </main>
      </ToastProvider>
    </div>
  );
}
