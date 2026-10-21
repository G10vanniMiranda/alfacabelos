import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { assertSafeTestEnvironment } from "@/scripts/assert-safe-test-environment";

async function main() {
  assertSafeTestEnvironment();
  const [access, barbers, services, clients] = await Promise.all([
    prisma.adminAccess.findMany({ where: { email: { startsWith: "qa-" } }, select: { id: true } }),
    prisma.barber.findMany({ where: { name: { startsWith: "Profissional QA" } }, select: { id: true } }),
    prisma.service.findMany({ where: { name: { startsWith: "Servico recorrente QA" } }, select: { id: true } }),
    prisma.client.findMany({ where: { OR: [{ name: { startsWith: "Cliente QA" } }, { name: { startsWith: "Cliente pendente" } }] }, select: { id: true, phone: true } }),
  ]);
  const ids = access.map((item) => item.id);
  if (ids.length) {
    await prisma.adminSession.deleteMany({ where: { adminAccessId: { in: ids } } });
    await prisma.adminAccess.deleteMany({ where: { id: { in: ids } } });
  }
  const barberIds = barbers.map((item) => item.id);
  const serviceIds = services.map((item) => item.id);
  const clientIds = clients.map((item) => item.id);
  const series = await prisma.bookingSeries.findMany({ where: { OR: [{ barberId: { in: barberIds } }, { serviceId: { in: serviceIds } }, { clientId: { in: clientIds } }] }, select: { id: true } });
  const seriesIds = series.map((item) => item.id);
  const bookings = await prisma.booking.findMany({ where: { OR: [{ barberId: { in: barberIds } }, { serviceId: { in: serviceIds } }, { clientId: { in: clientIds } }] }, select: { id: true } });
  const bookingIds = bookings.map((item) => item.id);
  await prisma.notificationDelivery.deleteMany({ where: { OR: [{ bookingId: { in: bookingIds } }, { seriesId: { in: seriesIds } }, { recipient: { in: clients.map((item) => item.phone) } }] } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.bookingSeries.deleteMany({ where: { id: { in: seriesIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.barber.deleteMany({ where: { id: { in: barberIds } } });
  console.log(`PHASE5_FIXTURES_REMOVED adminAccess=${ids.length} bookings=${bookingIds.length} clients=${clientIds.length} barbers=${barberIds.length} services=${serviceIds.length}`);
}

main().finally(() => prisma.$disconnect());
