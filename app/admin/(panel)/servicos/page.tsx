import { AdminServices } from "@/components/admin/admin-services";
import { listServices } from "@/lib/booking-service";

export const metadata = {
  title: "Servicos | Admin",
};

export default async function AdminServicosPage() {
  const services = await listServices();
  return <AdminServices services={services} />;
}
