# ALFA Barber - Agendamento Online

Projeto completo de barbearia com Next.js (App Router), TypeScript e TailwindCSS, com fluxo de agendamento em 4 passos e painel admin para gestao da agenda.

## Visao Geral

- Home de marketing com CTA, servicos, equipe, precos, depoimentos, galeria, localizacao, FAQ e rodape.
- Cliente precisa criar conta e fazer login para acessar `/agendar`.
- Fluxo `/agendar` com Stepper (4 passos): servico -> barbeiro -> data/horario -> dados do cliente.
- Regras de agenda:
  - horario configuravel (seg-sab 09:00-19:00)
  - slots de 30 min
  - duracao por servico
  - buffer entre atendimentos (10 min)
  - bloqueio de conflitos por barbeiro/horario
- Pagina `/confirmacao` com resumo e status do agendamento.
- `/admin` com login persistido no banco, RBAC `ADMIN`/`BARBER`, filtros e acoes de confirmar/cancelar e bloqueios.
- `/admin/acessos` para gerenciar contas de acesso ao painel (email + senha com hash).
- `/admin/ganhos` para acompanhar faturamento por periodo (confirmados, previsao pendente, ticket medio e detalhamento).
- Validacao com Zod e Server Actions para operacoes criticas.
- API routes locais para listagem de dados e horarios disponiveis.

## Stack

- Next.js 16 (compativel com requisito 14+)
- App Router
- TypeScript
- TailwindCSS v4
- Zod
- Prisma + PostgreSQL/Supabase

## Estrutura de Pastas

```txt
app/
  api/
    services/route.ts
    barbers/route.ts
    available-slots/route.ts
    booking/route.ts
    admin/
      bookings/route.ts
      blocked-slots/route.ts
  admin/page.tsx
  agendar/page.tsx
  confirmacao/page.tsx
  globals.css
  layout.tsx
  page.tsx
components/
  admin/
    admin-login.tsx
  home/
    hero-section.tsx
    home-sections.tsx
  scheduler/
    available-slots.tsx
    scheduler-wizard.tsx
    stepper.tsx
  ui/
    site-header.tsx
    status-badge.tsx
    toast.tsx
lib/
  actions/
    booking-actions.ts
  data/
    seed.ts
  repositories/
    index.ts
    types.ts
  validators/
    schemas.ts
  booking-service.ts
  config.ts
  time.ts
  utils.ts
types/
  domain.ts
  scheduler.ts
prisma/
  schema.prisma
  seed.ts
```

## Variaveis de Ambiente

Crie `.env.local`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/alfa_barber
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
SUPABASE_STORAGE_BUCKET=galeria
WHATSAPP_ENABLED=false
WHATSAPP_API_URL=
WHATSAPP_API_TOKEN=
WHATSAPP_OWNER_PHONE=
WHATSAPP_INSTANCE_ID=
BARBERSHOP_ADDRESS=
```

Use [`.env.example`](.env.example) como checklist. Em produção, `APP_URL` deve conter o domínio HTTPS público; o sistema não gera links de confirmação apontando para `localhost` quando essa variável está ausente.

Observacao:
- `DATABASE_URL` e obrigatoria no ambiente.
- `APP_URL` ou `NEXT_PUBLIC_APP_URL` deve apontar para o dominio publico correto; ela e usada nos links de confirmacao e recuperacao de senha.
- O acesso admin agora e gerenciado pela secao `/admin/acessos`.
- Em producao, configure `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` para upload persistente da galeria.
- Notificacoes automaticas de WhatsApp so sao enviadas quando `WHATSAPP_ENABLED=true`.
- `WHATSAPP_OWNER_PHONE` deve ficar em formato brasileiro com DDD; o sistema normaliza para internacional, exemplo `5569999999999`.
- `BARBERSHOP_ADDRESS` e opcional e entra apenas na mensagem de confirmacao enviada ao cliente.

## Como Rodar

1. Instalar dependencias:

```bash
npm install
```

2. Rodar em desenvolvimento:

```bash
npm run dev
```

3. Lint:

```bash
npm run lint
```

4. Bootstrap do primeiro acesso admin (necessario em ambiente novo):

```bash
npm run admin:create -- admin@empresa.com sua_senha_forte
```

## Prisma (Obrigatorio - PostgreSQL/Supabase)

Schema pronto em `prisma/schema.prisma`.

Comandos:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:migrate:deploy
npm run prisma:seed
```

## Deploy (Vercel)

1. Configure no projeto da Vercel:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `APP_URL` e/ou `NEXT_PUBLIC_APP_URL`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET`
2. Aplique migrations no banco:

```bash
npm run prisma:migrate:deploy
```

3. Opcional para carga inicial:

```bash
npm run prisma:seed
```

## Endpoints e Acoes

### API Routes

- `GET /api/services` -> lista servicos ativos
- `GET /api/barbers` -> lista barbeiros ativos
- `GET /api/available-slots?date=YYYY-MM-DD&barberId=...&serviceId=...` -> horarios disponiveis
- `POST /api/booking` -> cria agendamento para cliente autenticado
- `GET /api/admin/bookings` -> lista agendamentos (filtros opcionais)
- `PATCH /api/admin/bookings` -> atualiza status
- `GET /api/admin/blocked-slots` -> lista bloqueios
- `POST /api/admin/blocked-slots` -> cria bloqueio
- `DELETE /api/admin/blocked-slots?blockedSlotId=...` -> remove bloqueio

### Server Actions

- `createClientBookingsAction` / `createAdminBookingsAction`
- `updateBookingStatusAction`
- `createBlockedSlotAction`
- `deleteBlockedSlotAction`
- `adminLoginAction` / `adminLogoutAction`
- `createAdminAccessAction` / `deleteAdminAccessAction`

## WhatsApp

O envio automatico fica centralizado em `lib/whatsapp.ts`.

Fluxos implementados:

- Cliente agenda pelo site (`createClientBookingsAction`): envia WhatsApp para o dono/barbeiro configurado em `WHATSAPP_OWNER_PHONE`.
- Painel admin cria agendamento (`createAdminBookingsAction`): envia confirmacao por WhatsApp para o cliente.
- Recuperacao de senha (`/esqueci-minha-senha`): envia um link temporario por WhatsApp para o telefone cadastrado.
- `POST /api/booking`: tambem notifica o dono/barbeiro, caso esse endpoint seja usado por uma integracao externa.

Variaveis:

```env
WHATSAPP_ENABLED=true
WHATSAPP_API_URL=https://sua-api-de-whatsapp/send
WHATSAPP_API_TOKEN=seu_token
WHATSAPP_OWNER_PHONE=5569999999999
WHATSAPP_INSTANCE_ID=sua_instancia
BARBERSHOP_ADDRESS=Endereco da barbearia
APP_URL=https://seu-dominio.com
NEXT_PUBLIC_APP_URL=https://seu-dominio.com
```

Regras tecnicas:

- Se `WHATSAPP_ENABLED=false` ou ausente, o agendamento e salvo e nenhuma mensagem e enviada.
- Se telefone, token ou URL estiverem ausentes/invalidos, o erro e registrado no console e o agendamento continua salvo.
- Se a API do WhatsApp falhar, o erro e registrado no console e o agendamento continua salvo.
- O telefone e normalizado para formato internacional do Brasil (`55 + DDD + numero`).
- Tokens de recuperacao de senha expiram em 30 minutos, sao salvos apenas como hash e sao invalidados apos o uso ou quando um novo token e solicitado.

Troca futura de API:

- Mantenha as credenciais somente em variaveis de ambiente.
- Ajuste apenas `buildWhatsAppPayload` e, se necessario, `resolveWhatsAppEndpoint` em `lib/whatsapp.ts`.
- A camada ja monta payloads basicos para URLs da WhatsApp Cloud API (`graph.facebook.com`), Evolution API (`evolution`) e Z-API (`z-api`/`zapi`). Para outro provedor, adapte o corpo JSON no mesmo arquivo.

## Fluxo de Teste (Manual)

1. Acesse `/agendar`.
2. Se nao estiver autenticado, faca login em `/cliente/login` ou cadastre em `/cliente/cadastro`.
3. Selecione servico e barbeiro.
4. Escolha data futura e horario disponivel.
5. Preencha/confira nome + telefone e confirme.
6. Valide redirecionamento para `/confirmacao?id=...`.
7. Acesse `/admin` e faca login com um email/senha cadastrado em `/admin/acessos`.
8. No menu lateral, acesse `/admin/acessos` para cadastrar ou remover acessos admin.
9. Confirme/cancele um agendamento.
10. Crie um bloqueio e veja o horario sumir no fluxo de agendamento.

## Observacoes Tecnicas

- O repositorio padrao esta em `lib/repositories/prisma.ts`.
- Cadastro/login de cliente persiste no banco com hash de senha.
- Conflitos sao barrados por sobreposicao de intervalo (`start/end`) considerando buffer.
