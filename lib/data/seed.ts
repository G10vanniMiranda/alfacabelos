import { DEFAULT_BARBER_ID, DEFAULT_BARBER_NAME } from "@/lib/constants/barber";
import { Barber, Service } from "@/types/domain";

export const barbersSeed: Barber[] = [
  {
    id: DEFAULT_BARBER_ID,
    name: DEFAULT_BARBER_NAME,
    avatarUrl: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=200&q=80",
    isActive: true,
  },
];

export const servicesSeed: Service[] = [
  { id: "service-corte", name: "Corte", durationMinutes: 45, priceCents: 5500, isActive: true },
  { id: "service-barba", name: "Barba", durationMinutes: 30, priceCents: 4000, isActive: true },
  {
    id: "service-combo",
    name: "Corte + Barba",
    durationMinutes: 75,
    priceCents: 8900,
    isActive: true,
  },
  {
    id: "service-sobrancelha",
    name: "Sobrancelha",
    durationMinutes: 20,
    priceCents: 2500,
    isActive: true,
  },
];

export const testimonials = [
  {
    name: "Andre P.",
    text: "Melhor atendimento da região. Agenda online muito rápida.",
  },
  {
    name: "Lucas M.",
    text: "Ambiente premium, barbeiro pontual e corte impecável.",
  },
  {
    name: "Diego F.",
    text: "Consegui reservar em 2 minutos e fui atendido no horário.",
  },
];
