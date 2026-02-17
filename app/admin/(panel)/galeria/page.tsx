import { AdminGallery } from "@/components/admin/admin-gallery";
import { listGalleryImages } from "@/lib/booking-service";

export const metadata = {
  title: "Galeria | Admin",
};

export default async function AdminGaleriaPage() {
  const images = await listGalleryImages();
  return <AdminGallery images={images} />;
}
