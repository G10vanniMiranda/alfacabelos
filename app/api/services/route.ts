import { NextResponse } from "next/server";
import { listServices } from "@/lib/booking-service";
import { isDatabaseUnavailableError } from "@/lib/errors";

export async function GET() {
  try {
    const services = await listServices();
    return NextResponse.json(services);
  } catch (error) {
    console.error("GET /api/services failed", error);
    return NextResponse.json(
      { message: "Catálogo temporariamente indisponível." },
      { status: isDatabaseUnavailableError(error) ? 503 : 500 },
    );
  }
}

