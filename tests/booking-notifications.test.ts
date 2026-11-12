import assert from "node:assert/strict";
import test from "node:test";
import { buildBookingNotificationIntents, buildSeriesNotificationIntents, BOOKING_EVENT_AUDIENCES } from "../lib/notifications/booking-intents";
import { bookingAudienceFromKey, evaluateNotificationValidity, notificationValidityUpperBound } from "../lib/notifications/validity-policy";
import { bookingReference, buildSeriesNotificationMessage, type BookingNotificationSnapshot } from "../lib/whatsapp";

// Synthetic numbers only (DDD 20 is not assigned in Brazil).
const OWNER = "(20) 90000-0001";
const CLIENT = "(20) 90000-0031";
const OWNER_E164 = "5520900000001";
const CLIENT_E164 = "5520900000031";

const snapshot: BookingNotificationSnapshot = {
  id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
  customerName: "[QA] Cliente Sintético",
  customerPhone: CLIENT,
  observations: "Prefere máquina 2",
  dateTimeStart: "2037-03-03T14:00:00.000Z",
  status: "PENDENTE",
  service: { name: "[QA] Corte Sintético", priceCents: 1000 },
  barber: { name: "[QA] Barbeiro Sintético" },
};

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return run(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const build = (event: Parameters<typeof buildBookingNotificationIntents>[0]["event"], extra: Partial<Parameters<typeof buildBookingNotificationIntents>[0]> = {}, env: Record<string, string | undefined> = {}) =>
  withEnv({ WHATSAPP_OWNER_PHONE: OWNER, WHATSAPP_PROVIDER: "evolution", ...env }, () => buildBookingNotificationIntents({ snapshot, event, requestId: "req-1", ...extra }));

const byAudience = (intents: ReturnType<typeof buildBookingNotificationIntents>) =>
  Object.fromEntries(intents.map((intent) => [bookingAudienceFromKey(intent.idempotencyKey), intent]));

for (const event of ["BOOKING_CREATED_BY_CLIENT", "BOOKING_CREATED_BY_STAFF", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"] as const) {
  test(`${event}: responsável e cliente recebem, cada um com chave e telefone normalizado próprios`, () => {
    const intents = build(event, { actor: "CLIENT" });
    assert.equal(intents.length, 2);
    const { OWNER: owner, CLIENT: client } = byAudience(intents);
    assert.equal(owner?.to, OWNER_E164);
    assert.equal(client?.to, CLIENT_E164);
    assert.notEqual(owner!.idempotencyKey, client!.idempotencyKey);
    assert.match(owner!.idempotencyKey, new RegExp(`^booking:${snapshot.id}:owner:${event.toLowerCase()}`));
    for (const intent of intents) {
      assert.equal(intent.event, event);
      assert.equal(intent.bookingId, snapshot.id);
      assert.equal(intent.requestId, "req-1");
      assert.match(intent.message, /\[QA\] Corte Sintético/, "serviço");
      assert.match(intent.message, /Horário: \d{2}:\d{2}/, "horário");
      assert.match(intent.message, /2037/, "data");
    }
    assert.match(owner!.message, /Cliente: \[QA\] Cliente Sintético/);
    assert.doesNotMatch(client!.message, /Telefone:/, "cliente não recebe dados de contato");
    assert.match(client!.message, new RegExp(bookingReference(snapshot.id).replace("#", "#")));
  });
}

test("matriz final: lembrete continua só para o cliente", () => {
  assert.deepEqual(BOOKING_EVENT_AUDIENCES.BOOKING_REMINDER, ["CLIENT"]);
  const intents = build("BOOKING_REMINDER");
  assert.equal(intents.length, 1);
  assert.equal(bookingAudienceFromKey(intents[0]!.idempotencyKey), "CLIENT");
  assert.match(intents[0]!.idempotencyKey, /:booking_reminder:2037-03-03T14:00:00.000Z$/);
});

test("criação pela equipe: link de confirmação só vai para o cliente", () => {
  const intents = build("BOOKING_CREATED_BY_STAFF", { snapshot: { ...snapshot, confirmationToken: "token-sintetico-de-teste-123" } }, { APP_URL: "https://alfa.example.test" });
  const { OWNER: owner, CLIENT: client } = byAudience(intents);
  assert.match(client!.message, /confirmar-agendamento\?token=token-sintetico-de-teste-123/);
  assert.doesNotMatch(owner!.message, /token|confirmar-agendamento/i);
  assert.match(owner!.message, /criado pela equipe/);
});

test("mensagens por público e por autor da mudança", () => {
  const cancelByClient = byAudience(build("BOOKING_CANCELLED", { actor: "CLIENT" }));
  assert.match(cancelByClient.OWNER!.message, /Cancelado por: cliente/);
  assert.match(cancelByClient.CLIENT!.message, /Confirmamos o cancelamento/);
  const cancelByStaff = byAudience(build("BOOKING_CANCELLED", { actor: "STAFF" }));
  assert.match(cancelByStaff.OWNER!.message, /Cancelado por: equipe/);
  assert.match(cancelByStaff.CLIENT!.message, /cancelado pela nossa equipe/);
  const reschedule = byAudience(build("BOOKING_RESCHEDULED", { actor: "STAFF" }));
  assert.match(reschedule.OWNER!.message, /Remarcado por: equipe/);
  assert.match(reschedule.CLIENT!.message, /Novo horário:/);
  const created = byAudience(build("BOOKING_CREATED_BY_CLIENT"));
  assert.match(created.CLIENT!.message, /Recebemos o seu agendamento/);
  assert.match(created.OWNER!.message, /Observações: Prefere máquina 2/);
  assert.doesNotMatch(created.CLIENT!.message, /Observações/);
});

test("mesmo número para os dois públicos: uma única mensagem, a do cliente", () => {
  const intents = build("BOOKING_CREATED_BY_STAFF", { snapshot: { ...snapshot, confirmationToken: "tok" } }, { WHATSAPP_OWNER_PHONE: "+55 (20) 90000-0031" });
  assert.equal(intents.length, 1);
  assert.equal(bookingAudienceFromKey(intents[0]!.idempotencyKey), "CLIENT");
  assert.match(intents[0]!.message, /confirmar-agendamento/, "ação do cliente preservada");
});

test("telefone ausente ou inválido afeta só o próprio destinatário", () => {
  assert.deepEqual(build("BOOKING_CANCELLED", {}, { WHATSAPP_OWNER_PHONE: undefined }).map((item) => bookingAudienceFromKey(item.idempotencyKey)), ["CLIENT"]);
  assert.deepEqual(build("BOOKING_CANCELLED", {}, { WHATSAPP_OWNER_PHONE: "123" }).map((item) => bookingAudienceFromKey(item.idempotencyKey)), ["CLIENT"]);
  assert.deepEqual(build("BOOKING_CANCELLED", { snapshot: { ...snapshot, customerPhone: "abc" } }).map((item) => bookingAudienceFromKey(item.idempotencyKey)), ["OWNER"]);
  assert.deepEqual(build("BOOKING_CANCELLED", { snapshot: { ...snapshot, customerPhone: "abc" } }, { WHATSAPP_OWNER_PHONE: undefined }), []);
});

test("Meta sem templates UTILITY: nenhum aviso de agendamento é enfileirado", () => {
  assert.deepEqual(build("BOOKING_CREATED_BY_CLIENT", {}, { WHATSAPP_PROVIDER: "meta" }), []);
});

test("idempotência: mesmo evento gera as mesmas chaves; reagendamentos diferentes não colidem", () => {
  assert.deepEqual(build("BOOKING_CANCELLED").map((item) => item.idempotencyKey), build("BOOKING_CANCELLED").map((item) => item.idempotencyKey));
  const first = build("BOOKING_RESCHEDULED").map((item) => item.idempotencyKey);
  const second = build("BOOKING_RESCHEDULED", { snapshot: { ...snapshot, dateTimeStart: "2037-03-04T14:00:00.000Z" } }).map((item) => item.idempotencyKey);
  assert.equal(first.filter((key) => second.includes(key)).length, 0);
});

const SERIES_ID = "series-qa-0001";
function occurrences(count: number): BookingNotificationSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    ...snapshot,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    dateTimeStart: new Date(Date.UTC(2037, 2, 3 + index, 14)).toISOString(),
  }));
}
const buildSeries = (count: number, event: Parameters<typeof buildSeriesNotificationIntents>[0]["event"], extra: Partial<Parameters<typeof buildSeriesNotificationIntents>[0]> = {}, env: Record<string, string | undefined> = {}) =>
  withEnv({ WHATSAPP_OWNER_PHONE: OWNER, WHATSAPP_PROVIDER: "evolution", ...env }, () =>
    buildSeriesNotificationIntents({ seriesId: SERIES_ID, occurrences: [...occurrences(count)].reverse(), event, requestId: "req-s", ...extra }));

for (const count of [2, 59]) {
  test(`série com ${count} ocorrências: uma mensagem consolidada por destinatário`, () => {
    const intents = buildSeries(count, "BOOKING_CREATED_BY_CLIENT");
    assert.equal(intents.length, 2);
    const { OWNER: owner, CLIENT: client } = byAudience(intents);
    assert.equal(owner!.idempotencyKey, `series:${SERIES_ID}:owner:booking_created_by_client`);
    assert.equal(client!.idempotencyKey, `series:${SERIES_ID}:client:booking_created_by_client`);
    for (const intent of intents) {
      assert.equal(intent.seriesId, SERIES_ID);
      assert.equal(intent.bookingId, occurrences(count)[0]!.id, "âncora = primeira ocorrência");
      assert.match(intent.message, new RegExp(`Horários: ${count}`));
      assert.match(intent.message, /Período: .*2037 a .*2037/);
      assert.match(intent.message, /\[QA\] Corte Sintético/);
      assert.ok(intent.message.length < 1500, "bem abaixo do limite do canal");
      assert.equal((intent.message.match(/^• /gm) ?? []).length, Math.min(count, 10));
    }
    if (count > 10) assert.match(client!.message, new RegExp(`e mais ${count - 10} horário`));
    assert.match(owner!.message, /Série: series-qa-0001/);
    assert.doesNotMatch(client!.message, /Telefone:|Série:/);
  });
}

test("série: cancelamento ancorado na última ocorrência e reagendamento na primeira, com chave do grupo", () => {
  const cancel = byAudience(buildSeries(5, "BOOKING_CANCELLED", { actor: "CLIENT" }));
  assert.equal(cancel.OWNER!.bookingId, occurrences(5)[4]!.id);
  assert.match(cancel.OWNER!.idempotencyKey, /^series:series-qa-0001:owner:[0-9a-f]{12}:booking_cancelled$/);
  assert.match(cancel.OWNER!.message, /Cancelado por: cliente/);
  const reschedule = byAudience(buildSeries(5, "BOOKING_RESCHEDULED", { actor: "STAFF" }));
  assert.equal(reschedule.CLIENT!.bookingId, occurrences(5)[0]!.id);
  assert.match(reschedule.CLIENT!.idempotencyKey, new RegExp(`:booking_rescheduled:${occurrences(5)[0]!.dateTimeStart}$`));
  assert.match(reschedule.CLIENT!.message, /Novos horários: 5/);
  const otherGroup = buildSeriesNotificationIntents({ seriesId: SERIES_ID, occurrences: occurrences(4), event: "BOOKING_CANCELLED" });
  assert.notEqual(otherGroup[0]?.idempotencyKey, cancel.CLIENT!.idempotencyKey, "grupos diferentes não colidem");
});

test("série criada pela equipe: só o link da primeira ocorrência, e só para o cliente", () => {
  const list = occurrences(3).map((item, index) => ({ ...item, confirmationToken: index === 0 ? "token-primeiro-sintetico" : undefined }));
  const intents = withEnv({ WHATSAPP_OWNER_PHONE: OWNER, WHATSAPP_PROVIDER: "evolution", APP_URL: "https://alfa.example.test" }, () =>
    buildSeriesNotificationIntents({ seriesId: SERIES_ID, occurrences: list, event: "BOOKING_CREATED_BY_STAFF" }));
  const { OWNER: owner, CLIENT: client } = byAudience(intents);
  assert.equal((client!.message.match(/confirmar-agendamento/g) ?? []).length, 1);
  assert.match(client!.message, /token=token-primeiro-sintetico/);
  assert.doesNotMatch(owner!.message, /token|confirmar-agendamento/);
});

test("resumo de criação: status de cada horário e link que confirma só uma ocorrência", () => {
  const list = occurrences(3).map((item, index) => ({ ...item, status: index === 0 ? "CONFIRMADO" : "PENDENTE" }));
  const withLink = buildSeriesNotificationMessage({
    event: "BOOKING_CREATED_BY_STAFF", audience: "CLIENT", actor: "STAFF", occurrences: list, seriesId: SERIES_ID,
    confirmation: { link: "https://alfa.example.test/confirmar-agendamento?token=abc", occurrence: list[1]! },
  });
  assert.match(withLink, /— confirmado/);
  assert.equal((withLink.match(/— aguardando confirmação/g) ?? []).length, 2);
  assert.match(withLink, /Para confirmar o horário de .*04\/03.*, use o link:/, "o link nomeia a ocorrência que confirma");
  assert.match(withLink, /Este link confirma somente esse horário\./);
  assert.match(withLink, /Os demais horários aguardando confirmação podem ser confirmados conosco\./);
  const noLink = buildSeriesNotificationMessage({ event: "BOOKING_CREATED_BY_STAFF", audience: "CLIENT", actor: "STAFF", occurrences: list, seriesId: SERIES_ID });
  assert.doesNotMatch(noLink, /link|token/i);
  assert.match(noLink, /Os horários aguardando confirmação podem ser confirmados conosco\./);
  const allConfirmed = buildSeriesNotificationMessage({ event: "BOOKING_CREATED_BY_STAFF", audience: "CLIENT", actor: "STAFF", occurrences: list.map((item) => ({ ...item, status: "CONFIRMADO" })), seriesId: SERIES_ID });
  assert.doesNotMatch(allConfirmed, /aguardando|podem ser confirmados/);
  const cancel = buildSeriesNotificationMessage({ event: "BOOKING_CANCELLED", audience: "CLIENT", actor: "CLIENT", occurrences: list, seriesId: SERIES_ID });
  assert.doesNotMatch(cancel, /— confirmado|aguardando/, "cancelamento não lista status");
});

test("validade da criação de série: depende de haver ocorrência futura ativa, não da âncora", () => {
  const now = new Date("2037-03-01T12:00:00.000Z");
  const subject = { event: "BOOKING_CREATED_BY_STAFF" as const, bookingId: "anchor", seriesId: SERIES_ID, createdAt: new Date("2037-03-01T11:00:00.000Z"), idempotencyKey: `series:${SERIES_ID}:client:booking_created_by_staff` };
  const cancelledAnchor = { status: "CANCELADO" as const, dateTimeStart: new Date("2037-03-03T14:00:00.000Z"), confirmationTokenHash: "h", confirmationTokenExpiresAt: null, confirmationTokenUsedAt: null };
  const occurrence = (status: "PENDENTE" | "CONFIRMADO" | "CANCELADO", day: number) => ({ status, dateTimeStart: new Date(Date.UTC(2037, 2, day, 14)) });
  const evaluate = (seriesOccurrences: ReturnType<typeof occurrence>[], at = now) =>
    evaluateNotificationValidity(subject, { booking: cancelledAnchor, passwordResetToken: null, seriesOccurrences }, at);
  assert.equal(evaluate([occurrence("CANCELADO", 3), occurrence("PENDENTE", 4)]).outcome, "VALID", "âncora cancelada não derruba o resumo");
  assert.equal(evaluate([occurrence("CONFIRMADO", 4)]).outcome, "VALID");
  assert.deepEqual(evaluate([occurrence("CANCELADO", 3), occurrence("CANCELADO", 4)]), { outcome: "INVALID", classification: "CANCELED", reason: "series_no_upcoming_occurrence" });
  assert.deepEqual(evaluate([occurrence("PENDENTE", 3)], new Date("2037-03-03T15:00:00.000Z")).outcome, "INVALID", "só ocorrências passadas");
  assert.equal(evaluate([occurrence("PENDENTE", 4)], new Date("2037-03-01T17:30:00.000Z")).outcome, "INVALID", "mais de 6 h");
  assert.equal(evaluate([]).outcome, "INVALID", "série removida");
});

test("série: mesmo número para os dois públicos gera uma única mensagem", () => {
  assert.equal(buildSeries(3, "BOOKING_CANCELLED", {}, { WHATSAPP_OWNER_PHONE: CLIENT }).length, 1);
});

test("outbox: avisos de cancelamento e reagendamento expiram 6 h após o enfileiramento", () => {
  const start = new Date("2037-03-20T14:00:00.000Z");
  const createdAt = new Date("2037-03-01T08:00:00.000Z");
  const references = { booking: { status: "CANCELADO" as const, dateTimeStart: start, confirmationTokenHash: null, confirmationTokenExpiresAt: null, confirmationTokenUsedAt: null }, passwordResetToken: null };
  const cancel = { event: "BOOKING_CANCELLED" as const, bookingId: snapshot.id, createdAt, idempotencyKey: `booking:${snapshot.id}:client:booking_cancelled` };
  assert.equal(evaluateNotificationValidity(cancel, references, new Date(createdAt.getTime() + 5 * 3_600_000)).outcome, "VALID");
  const stale = evaluateNotificationValidity(cancel, references, new Date(createdAt.getTime() + 7 * 3_600_000));
  assert.deepEqual(stale, { outcome: "INVALID", classification: "EXPIRED", reason: "notice_too_old" });
  const reschedule = { event: "BOOKING_RESCHEDULED" as const, bookingId: snapshot.id, createdAt, idempotencyKey: `series:x:owner:abc:booking_rescheduled:${start.toISOString()}` };
  const active = { ...references, booking: { ...references.booking, status: "CONFIRMADO" as const } };
  assert.equal(evaluateNotificationValidity(reschedule, active, new Date(createdAt.getTime() + 7 * 3_600_000)).outcome, "INVALID");
  assert.deepEqual(notificationValidityUpperBound(reschedule), new Date(createdAt.getTime() + 6 * 3_600_000));
  assert.equal(bookingAudienceFromKey(reschedule.idempotencyKey), "OWNER");
});

test("validade: aviso ao responsável não morre quando o cliente confirma; o do cliente sim", () => {
  const now = new Date("2037-03-01T12:00:00.000Z");
  const booking = {
    status: "CONFIRMADO" as const, dateTimeStart: new Date(snapshot.dateTimeStart),
    confirmationTokenHash: "hash", confirmationTokenExpiresAt: new Date("2037-03-02T00:00:00.000Z"), confirmationTokenUsedAt: now,
  };
  const subject = (audience: string) => ({
    event: "BOOKING_CREATED_BY_STAFF" as const, bookingId: snapshot.id, createdAt: new Date("2037-03-01T11:00:00.000Z"),
    idempotencyKey: `booking:${snapshot.id}:${audience}:booking_created_by_staff`,
  });
  const references = { booking, passwordResetToken: null };
  assert.equal(evaluateNotificationValidity(subject("owner"), references, now).outcome, "VALID");
  assert.equal(evaluateNotificationValidity(subject("client"), references, now).outcome, "INVALID");
  assert.equal(bookingAudienceFromKey("password-reset:abc"), null);
});
