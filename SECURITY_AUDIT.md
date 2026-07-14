# SECURITY_AUDIT.md

## Resumo

Auditoria realizada no projeto Alfa Cabelos com foco em autenticacao, autorizacao, tokens, APIs, banco, integracoes WhatsApp, headers web, dependencias e deploy na Vercel.

O projeto ja tinha boas bases: cookies `httpOnly`, sessoes admin armazenadas como hash, senhas com `scrypt`, validacao com Zod, queries Prisma parametrizadas/raw tagged e protecao de rotas admin pelo layout. As correcoes aplicadas endurecem os fluxos publicos e reduzem risco de abuso sem alterar login, cadastro, agendamentos, painel admin, confirmacao por WhatsApp ou recuperacao de senha.

## Problemas encontrados

| Gravidade | Local | Problema | Risco real | Correcao aplicada |
| --- | --- | --- | --- | --- |
| Alta | `Booking.confirmationToken`, `lib/booking-service.ts`, `lib/repositories/prisma.ts` | Token de confirmacao de agendamento era salvo em texto puro. | Vazamento de banco permitiria confirmar agendamentos pendentes com tokens validos. | Adicionado `confirmationTokenHash`; novos tokens sao enviados brutos apenas no WhatsApp e salvos como SHA-256. Links antigos continuam aceitos durante transicao. |
| Alta | `components/actions` e `app/api/booking/route.ts` | Ausencia de rate limit no login cliente, recuperacao e confirmacao/agendamento publico. | Brute force, spam de WhatsApp e abuso de criacao/confirmacao. | Criado `SecurityRateLimitEvent` e helper central de rate limit para login cliente, recuperacao, confirmacao e criacao publica de agendamento. |
| Critica | Supabase RLS | Dez politicas concediam `ALL` ao papel `public` com `USING (true)` e `WITH CHECK (true)`. | Leitura e mutacao anonima de clientes, sessoes, acessos administrativos e dados operacionais via PostgREST. | Todas as politicas publicas foram removidas, RLS foi habilitado nas 14 tabelas e privilegios de `anon`/`authenticated` foram revogados. |
| Media | `app/api/admin/bookings/route.ts`, `app/api/admin/blocked-slots/route.ts` | Mutacoes admin em route handlers autenticados por cookie nao verificavam origem. | Reduzia defesa contra CSRF em chamadas JSON autenticadas. | Adicionada validacao de mesma origem para `PATCH`, `POST` e `DELETE` admin. |
| Media | `next.config.ts` | Headers de seguranca estavam bons, mas incompletos. | Menor protecao contra downgrade HTTPS, plugins/objetos e XSS residual. | Adicionados HSTS, `object-src 'none'` e `upgrade-insecure-requests` em producao. |
| Media | `package-lock.json` | `npm audit` apontou `postcss < 8.5.10` transitivo em `next`. | Vulnerabilidade moderada de XSS no stringify do PostCSS. | Adicionado `overrides.postcss` para `^8.5.10`; lockfile atualizado; auditoria passou com 0 vulnerabilidades. |
| Baixa | Logs de envio/rotas | Alguns erros eram logados com contexto tecnico. | Risco operacional baixo; nao havia token sensivel logado, mas detalhes externos poderiam poluir logs. | Fluxos novos usam logs genericos e nunca registram token bruto. |

## Correcoes aplicadas

- Banco:
  - `PasswordResetToken` salva apenas hash do token de recuperacao.
  - `Booking.confirmationTokenHash` salva hash dos novos tokens de confirmacao.
  - `SecurityRateLimitEvent` centraliza tentativas de acoes sensiveis.

- Autenticacao e autorizacao:
  - Login cliente recebeu rate limit por telefone normalizado.
  - Admin continua protegido por cookie `httpOnly`, sessao hasheada e layout protegido.
  - Area do cliente continua filtrando agendamentos pelo telefone autenticado e validando posse antes de cancelar/confirmar.

- Tokens:
  - Recuperacao de senha: token aleatorio, expira, uso unico, hash no banco.
  - Confirmacao de agendamento: novos tokens aleatorios sao hasheados no banco.
  - Links legados de confirmacao com token em texto puro continuam funcionando para nao quebrar mensagens ja enviadas.

- APIs e server actions:
  - Inputs continuam validados com Zod.
  - APIs admin mutaveis validam origem.
  - API de agendamento exige sessao de cliente e tem rate limit por IP + identificador do cliente.
  - Mensagens sensiveis seguem genericas quando necessario.

- Web:
  - CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e HSTS configurados.
  - `frame-ancestors 'none'` e `X-Frame-Options: DENY` reduzem risco de clickjacking.

- Dependencias:
  - `postcss` forçado para versao segura via `overrides`.

## Variaveis de ambiente necessarias

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXT_PUBLIC_APP_URL` ou `APP_URL`
- `VERCEL_URL` (fornecida pela Vercel quando aplicavel)
- `WHATSAPP_ENABLED`
- `WHATSAPP_API_URL`
- `WHATSAPP_API_TOKEN`
- `WHATSAPP_INSTANCE_ID` quando a API exigir
- `WHATSAPP_OWNER_PHONE`
- `BARBERSHOP_ADDRESS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_KEY`
- `SUPABASE_STORAGE_BUCKET`

## Checklist de seguranca

- [x] Senhas nao sao salvas em texto puro.
- [x] Sessoes admin sao salvas como hash.
- [x] Tokens de recuperacao de senha sao salvos como hash.
- [x] Novos tokens de confirmacao de agendamento sao salvos como hash.
- [x] Tokens tem expiracao e uso unico.
- [x] Login admin tem rate limit.
- [x] Login cliente tem rate limit.
- [x] Recuperacao de senha tem rate limit e resposta generica.
- [x] Confirmacao publica por token tem rate limit.
- [x] Criacao publica de agendamento tem rate limit.
- [x] Rotas admin de painel exigem sessao.
- [x] APIs admin exigem sessao.
- [x] Mutacoes admin em APIs validam origem.
- [x] RLS ativo nas 14 tabelas, sem politicas publicas permissivas.
- [x] Dados sensiveis de admin e senhas nao sao enviados ao frontend.
- [x] Headers de seguranca configurados.
- [x] Auditoria de dependencias sem vulnerabilidades apos override.
- [x] Aplicar migrations no banco do ambiente com `npm run prisma:migrate:deploy`.
- [ ] Validar envio real de WhatsApp no ambiente configurado.
- [ ] Revisar politicas RLS se o projeto passar a acessar Supabase diretamente pelo frontend.

## Testes e validacoes executadas

- `npm run prisma:generate`: passou.
- `npm run lint`: passou.
- `npm run build`: passou.
- `npm audit --audit-level=moderate`: inicialmente apontou `postcss`; apos override/lockfile, `npm install --package-lock-only` auditou 391 pacotes e reportou 0 vulnerabilidades.

## Testes manuais recomendados apos migration

- Login cliente valido e invalido.
- Rate limit de login cliente apos varias tentativas invalidas.
- Acesso a `/cliente` sem cookie deve redirecionar para login.
- Cliente autenticado deve ver apenas seus agendamentos.
- Admin deve acessar `/admin/*` somente autenticado.
- Admin criando agendamento deve enviar link WhatsApp com token funcional.
- Link de confirmacao valido deve confirmar uma vez.
- Link expirado/usado deve ser recusado.
- Recuperacao de senha por telefone cadastrado deve enviar WhatsApp.
- Recuperacao com telefone inexistente deve retornar mensagem generica.
- Token de recuperacao valido deve permitir nova senha.
- Token expirado/usado deve ser recusado.
- Nova senha deve permitir login.
- Cadastro e fluxo de agendamento publico devem continuar funcionando.

## Recomendacoes futuras

- Migrar tokens legados de confirmacao: manter `confirmationToken` apenas pelo periodo de expiracao maximo dos links antigos e depois remover a coluna em uma migration futura.
- Criar testes automatizados de integracao para auth, tokens e IDOR.
- Se o frontend passar a acessar Supabase diretamente no futuro, criar politicas RLS especificas por operacao sem reabrir acesso generico ao papel `public`.
- Considerar um provedor de rate limit externo para producao serverless com alto trafego.
- Avaliar Argon2id ou bcrypt com custo calibrado em uma janela futura; `scrypt` atual ja evita texto puro e e aceitavel.
