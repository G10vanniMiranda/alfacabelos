import { NextRequest, NextResponse } from "next/server";
import { createBlockedSlot, deleteBlockedSlot, listBlockedSlots } from "@/lib/booking-service";

function isAuthorized(request: NextRequest): boolean {
  return request.cookies.get("barber_admin")?.value === "ok";
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const blocked = await listBlockedSlots(date);
  return NextResponse.json(blocked);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const created = await createBlockedSlot(payload);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Erro ao criar bloqueio" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const blockedSlotId = request.nextUrl.searchParams.get("blockedSlotId");
  if (!blockedSlotId) {
    return NextResponse.json({ message: "blockedSlotId e obrigatorio" }, { status: 400 });
  }

  try {
    await deleteBlockedSlot(blockedSlotId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Erro ao remover bloqueio" },
      { status: 400 },
    );
  }
}

