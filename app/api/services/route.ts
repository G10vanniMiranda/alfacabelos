import { NextResponse } from "next/server";
import { listServices } from "@/lib/booking-service";

export async function GET() {
  const services = await listServices();
  return NextResponse.json(services);
}

