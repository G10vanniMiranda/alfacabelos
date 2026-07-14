import { AdminAccesses } from "@/components/admin/admin-accesses";
import { listAdminAccesses } from "@/lib/auth/admin-access-store";
import { AdminAccessUser } from "@/types/domain";
import { listBarbers } from "@/lib/booking-service";

export const metadata = {
  title: "Acessos | Admin",
};

export default async function AdminAcessosPage() {
  let accesses: AdminAccessUser[] = [];
  let loadError = "";

  try {
    accesses = await listAdminAccesses();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Falha ao carregar acessos admin";
  }

  const barbers = await listBarbers();
  return <AdminAccesses accesses={accesses} barbers={barbers} loadError={loadError} />;
}
