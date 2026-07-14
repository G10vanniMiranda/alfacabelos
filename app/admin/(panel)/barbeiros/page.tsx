import { AdminBarbers } from "@/components/admin/admin-barbers";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Barbeiros | Admin" };
export default async function AdminBarbersPage() {
  const rows = await prisma.barber.findMany({ orderBy: { name: "asc" } });
  return <AdminBarbers barbers={rows.map((row) => ({ ...row, avatarUrl: row.avatarUrl ?? undefined }))} />;
}
