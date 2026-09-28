import { normalizeWhatsAppPhone } from "@/lib/notifications/phone";

export type WhatsAppSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; retryable: boolean; category: string; error: string };

type WhatsAppProvider = "evolution" | "meta" | "zapi" | "custom";

function provider(): WhatsAppProvider {
  const configured = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (configured === "evolution") return "evolution";
  if (configured === "meta" || configured === "whatsapp-cloud") return "meta";
  if (configured === "z-api" || configured === "zapi") return "zapi";

  const url = process.env.WHATSAPP_API_URL?.toLowerCase() ?? "";
  if (url.includes("graph.facebook.com")) return "meta";
  if (url.includes("evolution")) return "evolution";
  if (url.includes("z-api") || url.includes("zapi")) return "zapi";
  return "custom";
}

function endpoint(providerName: WhatsAppProvider): string | null {
  const url = process.env.WHATSAPP_API_URL?.trim();
  if (!url) return null;
  const instanceId = process.env.WHATSAPP_INSTANCE_ID?.trim();
  if (providerName === "evolution" && url.includes("{instanceId}")) {
    return instanceId ? url.replace("{instanceId}", encodeURIComponent(instanceId)) : null;
  }
  return instanceId ? url.replace("{instanceId}", encodeURIComponent(instanceId)) : url;
}

function payload(providerName: WhatsAppProvider, phone: string, message: string) {
  if (providerName === "meta") {
    return { messaging_product: "whatsapp", to: phone, type: "text", text: { preview_url: false, body: message } };
  }
  if (providerName === "evolution") return { number: phone, text: message };
  if (providerName === "zapi") return { phone, message };
  return { phone, to: phone, message, text: message, instanceId: process.env.WHATSAPP_INSTANCE_ID };
}

function headers(providerName: WhatsAppProvider, token: string, idempotencyKey: string): HeadersInit {
  return {
    ...(providerName === "evolution" ? { apikey: token } : { authorization: `Bearer ${token}` }),
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };
}

function providerMessageId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = body as Record<string, unknown>;
  const key = value.key && typeof value.key === "object" ? value.key as Record<string, unknown> : undefined;
  const candidate = value.id ?? value.messageId ?? (Array.isArray(value.messages) && typeof value.messages[0] === "object"
    ? (value.messages[0] as Record<string, unknown>).id : undefined) ?? key?.id;
  return typeof candidate === "string" ? candidate.slice(0, 200) : undefined;
}

export async function sendWhatsAppOnce(input: {
  to: string;
  message: string;
  context: string;
  idempotencyKey: string;
}): Promise<WhatsAppSendResult> {
  const phone = normalizeWhatsAppPhone(input.to);
  if (!phone) return { ok: false, retryable: false, category: "invalid_recipient", error: "Invalid WhatsApp recipient" };
  if (!input.message.trim() || input.message.length > 4096) {
    return { ok: false, retryable: false, category: "invalid_payload", error: "Invalid WhatsApp payload" };
  }
  const providerName = provider();
  const url = endpoint(providerName);
  const token = process.env.WHATSAPP_API_TOKEN?.trim();
  if (!url || !token) return { ok: false, retryable: false, category: "configuration", error: "WhatsApp provider is not configured" };

  const controller = new AbortController();
  const timeoutMs = boundedTimeout(Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers(providerName, token, input.idempotencyKey),
      body: JSON.stringify(payload(providerName, phone, input.message)),
      signal: controller.signal,
    });
    const responseBody = await response.json().catch(() => undefined);
    if (response.ok) return { ok: true, providerMessageId: providerMessageId(responseBody) };
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    return {
      ok: false, retryable,
      category: response.status === 401 || response.status === 403 ? "authentication" : retryable ? "provider_transient" : "provider_permanent",
      error: `WhatsApp provider returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false, retryable: true,
      category: error instanceof Error && error.name === "AbortError" ? "timeout" : "network",
      error: error instanceof Error && error.name === "AbortError" ? `WhatsApp request timed out after ${timeoutMs}ms` : "WhatsApp network failure",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function boundedTimeout(value: number): number {
  return Number.isFinite(value) ? Math.min(30_000, Math.max(1_000, Math.trunc(value))) : 10_000;
}
