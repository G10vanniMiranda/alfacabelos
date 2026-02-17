import { PrismaClient } from "@prisma/client";
import { DEFAULT_BARBER_ID, DEFAULT_BARBER_NAME } from "../lib/constants/barber";

const prisma = new PrismaClient();

async function main() {
  await prisma.client.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.blockedSlot.deleteMany();
  await prisma.galleryImage.deleteMany();
  await prisma.barber.deleteMany();
  await prisma.service.deleteMany();

  const joaoVitor = await prisma.barber.create({
    data: {
      id: DEFAULT_BARBER_ID,
      name: DEFAULT_BARBER_NAME,
      avatarUrl:
        "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=200&q=80",
    },
  });

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
      barberId: joaoVitor.id,
      dateTimeStart: new Date(new Date().setHours(12, 0, 0, 0)),
      dateTimeEnd: new Date(new Date().setHours(13, 0, 0, 0)),
      reason: "Almoco",
    },
  });

  await prisma.galleryImage.createMany({
    data: [
      {
        imageUrl:
          "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=900&q=80",
        altText: "Cliente finalizando corte com acabamento moderno",
      },
      {
        imageUrl:
          "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=900&q=80",
        altText: "Ambiente da barbearia com cadeira e bancada profissional",
      },
    ],
  });

  console.log("Seed executado com sucesso", { joaoVitor: joaoVitor.id });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

