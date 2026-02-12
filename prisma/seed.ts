import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.client.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.blockedSlot.deleteMany();
  await prisma.barber.deleteMany();
  await prisma.service.deleteMany();

  const [caio, mateus, rodrigo] = await Promise.all([
    prisma.barber.create({
      data: {
        id: "barber-caio",
        name: "Caio Fernandes",
        avatarUrl:
          "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=200&q=80",
      },
    }),
    prisma.barber.create({
      data: {
        id: "barber-mateus",
        name: "Mateus Silva",
        avatarUrl:
          "https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=200&q=80",
      },
    }),
    prisma.barber.create({
      data: {
        id: "barber-rodrigo",
        name: "Rodrigo Lima",
        avatarUrl:
          "https://images.unsplash.com/photo-1622287162716-f311baa1a2b8?auto=format&fit=crop&w=200&q=80",
      },
    }),
  ]);

  await prisma.service.createMany({
    data: [
      { id: "service-corte", name: "Corte", durationMinutes: 45, priceCents: 5500 },
      { id: "service-barba", name: "Barba", durationMinutes: 30, priceCents: 4000 },
      { id: "service-combo", name: "Corte + Barba", durationMinutes: 75, priceCents: 8900 },
      { id: "service-sobrancelha", name: "Sobrancelha", durationMinutes: 20, priceCents: 2500 },
    ],
  });

  await prisma.blockedSlot.create({
    data: {
      barberId: caio.id,
      dateTimeStart: new Date(new Date().setHours(12, 0, 0, 0)),
      dateTimeEnd: new Date(new Date().setHours(13, 0, 0, 0)),
      reason: "Almoco",
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
