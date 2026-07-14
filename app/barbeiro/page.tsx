import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth/staff-auth";

export default async function BarberEntryPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin");
  redirect(staff.role === "ADMIN" ? "/admin/dashboard" : "/barbeiro/agenda");
}
