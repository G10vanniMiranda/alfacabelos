import { NextRequest, NextResponse } from "next/server";
import { createBlockedSlot, deleteBlockedSlot, listBlockedSlots } from "@/lib/booking-service";
import { isAdminSessionTokenValid } from "@/lib/auth/admin-session-store";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("barber_admin")?.value ?? "";
  return isAdminSessionTokenValid(token);
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ message: "Nao autorizado" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const blocked = await listBlockedSlots(date);
  return NextResponse.json(blocked);
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
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
  if (!(await isAuthorized(request))) {
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

