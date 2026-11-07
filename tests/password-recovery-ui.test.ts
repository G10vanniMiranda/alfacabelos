import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CodeStep,
  DoneStep,
  PasswordStep,
  PhoneStep,
  RecoveryProgress,
  type RecoveryState,
} from "../components/client/password-recovery-steps";

const noop = () => undefined;
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const state = (partial: Partial<RecoveryState>): RecoveryState => ({ step: "phone", status: "idle", message: "", ...partial });

test("etapa telefone: campo rotulado, intenção de solicitar e botão de envio", () => {
  const html = render(createElement(PhoneStep, { state: state({}), formAction: noop, pending: false }));
  assert.match(html, /<label for="recovery-phone">Telefone cadastrado<\/label>/);
  assert.match(html, /name="intent" value="request"/);
  assert.match(html, /autoComplete="tel"|autocomplete="tel"/i);
  assert.match(html, />Enviar código</);
});

test("canal indisponível aparece como alerta, sem expor detalhes técnicos", () => {
  const message = "No momento não conseguimos enviar códigos de recuperação. Tente novamente mais tarde ou fale com a barbearia.";
  const html = render(createElement(PhoneStep, { state: state({ status: "unavailable", message }), formAction: noop, pending: false }));
  assert.match(html, /role="alert"/);
  const feedback = /<div id="auth-feedback"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(feedback.includes(message));
  assert.doesNotMatch(feedback, /prisma|whatsapp_|stack|error|P\d{4}/i);
});

test("etapa código: entrada numérica de uso único, acessível e com reenvio controlado", () => {
  const html = render(createElement(CodeStep, {
    state: state({ step: "code", status: "sent", message: "Se este telefone estiver cadastrado, você receberá um código.", phone: "(20) 90000-0031" }),
    formAction: noop, pending: false, cooldownSeconds: 42,
  }));
  assert.match(html, /role="status"/, "envio confirmado é anunciado como status");
  assert.match(html, /<label for="recovery-code">Código de 8 números<\/label>/);
  assert.match(html, /inputMode="numeric"|inputmode="numeric"/i);
  assert.match(html, /autoComplete="one-time-code"|autocomplete="one-time-code"/i);
  assert.match(html, /pattern="\[0-9\]\{8\}"/);
  assert.match(html, /maxLength="8"|maxlength="8"/i);
  assert.match(html, /aria-describedby="recovery-code-hint"/);
  assert.match(html, /name="intent" value="verify"/);
  assert.match(html, /disabled="" aria-disabled="true">Pedir novo código em 42s</);
});

test("código incorreto marca o campo como inválido e liga a mensagem de erro", () => {
  const html = render(createElement(CodeStep, {
    state: state({ step: "code", status: "invalid", message: "Código incorreto. Confira os 8 números e tente novamente." }),
    formAction: noop, pending: false, cooldownSeconds: 0,
  }));
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="recovery-code-hint auth-feedback"/);
});

for (const status of ["expired", "locked"] as const) {
  test(`código ${status}: sem campo de código, ação principal é pedir um novo`, () => {
    const html = render(createElement(CodeStep, {
      state: state({ step: "code", status, message: "Peça um novo código." }),
      formAction: noop, pending: false, cooldownSeconds: 0,
    }));
    assert.doesNotMatch(html, /recovery-code"/);
    assert.match(html, /class="button-primary w-full"[^>]*>Pedir novo código</);
  });
}

test("etapa senha: dois campos de nova senha e aviso de encerramento de sessões", () => {
  const html = render(createElement(PasswordStep, { state: state({ step: "password", status: "verified", message: "Código confirmado." }), formAction: noop, pending: false }));
  assert.match(html, /name="intent" value="complete"/);
  assert.equal((html.match(/autoComplete="new-password"|autocomplete="new-password"/gi) ?? []).length, 2);
  assert.match(html, /name="confirmPassword"/);
  assert.match(html, /acessos abertos com a senha anterior serão encerrados/);
});

test("carregando: botão desabilitado com rótulo de progresso", () => {
  const html = render(createElement(PasswordStep, { state: state({ step: "password" }), formAction: noop, pending: true }));
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Salvando\.\.\./);
});

test("sucesso exige novo login", () => {
  const html = render(createElement(DoneStep, { state: state({ step: "done", status: "completed", message: "Senha definida com sucesso." }) }));
  assert.match(html, /role="status"/);
  assert.match(html, /href="\/cliente\/login\?senha=redefinida"/);
});

test("progresso indica a etapa atual para leitores de tela", () => {
  const html = render(createElement(RecoveryProgress, { step: "code" }));
  assert.match(html, /aria-label="Etapas da recuperação de senha"/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /Etapa 1, concluída: <\/span>Telefone/);
  assert.match(html, /Etapa 2, atual: <\/span>Código/);
});
