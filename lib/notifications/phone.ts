import { normalizeBrazilPhone } from "@/lib/phone";

export function normalizeWhatsAppPhone(phone: string): string | null {
  return normalizeBrazilPhone(phone)?.e164 ?? null;
}
