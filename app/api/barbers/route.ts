import { NextResponse } from "next/server";
import { listBarbers } from "@/lib/booking-service";
import { isDatabaseUnavailableError } from "@/lib/errors";

export async function GET() {
  try {
    const barbers = await listBarbers();
    return NextResponse.json(barbers);
  } catch (error) {
    console.error("GET /api/barbers failed", error);
    return NextResponse.json(
      { message: "Profissionais temporariamente indisponíveis." },
      { status: isDatabaseUnavailableError(error) ? 503 : 500 },
    );
  }
}

