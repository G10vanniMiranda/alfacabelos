import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.booking.deleteMany();
  await prisma.blockedSlot.deleteMany();
  await prisma.barber.deleteMany();
  await prisma.service.deleteMany();

  const [caio, mateus, rodrigo] = await Promise.all([
    prisma.barber.create({ data: { name: "Caio Fernandes" } }),
    prisma.barber.create({ data: { name: "Mateus Silva" } }),
    prisma.barber.create({ data: { name: "Rodrigo Lima" } }),
  ]);

  await prisma.service.createMany({
    data: [
      { name: "Corte", durationMinutes: 45, priceCents: 5500 },
      { name: "Barba", durationMinutes: 30, priceCents: 4000 },
      { name: "Corte + Barba", durationMinutes: 75, priceCents: 8900 },
      { name: "Sobrancelha", durationMinutes: 20, priceCents: 2500 },
    ],
  });

  await prisma.blockedSlot.create({
    data: {
      barberId: caio.id,
      dateTimeStart: new Date(new Date().setHours(12, 0, 0, 0)),
      dateTimeEnd: new Date(new Date().setHours(13, 0, 0, 0)),
      reason: "Almoo",
    },
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(19, 0, 0, 0);

  await prisma.blockedSlot.create({
    data: {
      barberId: mateus.id,
      dateTimeStart: tomorrow,
      dateTimeEnd: tomorrowEnd,
      reason: "Folga",
    },
  });

  console.log("Seed executado com sucesso", { caio: caio.id, mateus: mateus.id, rodrigo: rodrigo.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
