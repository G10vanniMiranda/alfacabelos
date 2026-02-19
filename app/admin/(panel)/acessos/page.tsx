import { AdminAccesses } from "@/components/admin/admin-accesses";
import { listAdminAccesses } from "@/lib/auth/admin-access-store";
import { AdminAccessUser } from "@/types/domain";

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

  return <AdminAccesses accesses={accesses} loadError={loadError} />;
}
