import { NextResponse } from "next/server";
import { listBarbers } from "@/lib/booking-service";

export async function GET() {
  const barbers = await listBarbers();
  return NextResponse.json(barbers);
}

