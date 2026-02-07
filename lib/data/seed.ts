import { Barber, Service } from "@/types/domain";

export const barbersSeed: Barber[] = [
  {
    id: "barber-caio",
    name: "Caio Fernandes",
    avatarUrl: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=200&q=80",
    isActive: true,
  },
  {
    id: "barber-mateus",
    name: "Mateus Silva",
    avatarUrl: "https://images.unsplash.com/photo-1521119989659-a83eee488004?auto=format&fit=crop&w=200&q=80",
    isActive: true,
  },
  {
    id: "barber-rodrigo",
    name: "Rodrigo Lima",
    avatarUrl: "https://images.unsplash.com/photo-1622287162716-f311baa1a2b8?auto=format&fit=crop&w=200&q=80",
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
    name: "Andr\u00e9 P.",
    text: "Melhor atendimento da regi\u00e3o. Agenda online muito r\u00e1pida.",
  },
  {
    name: "Lucas M.",
    text: "Ambiente premium, barbeiros pontuais e corte impec\u00e1vel.",
  },
  {
    name: "Diego F.",
    text: "Consegui reservar em 2 minutos e fui atendido no hor\u00e1rio.",
  },
];

