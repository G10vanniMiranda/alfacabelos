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
- `/admin` com login por senha em variavel de ambiente, filtros e acoes de confirmar/cancelar e bloqueios.
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
    admin-dashboard.tsx
    admin-login.tsx
  home/
    hero-section.tsx
    home-sections.tsx
  scheduler/
    available-slots.tsx
    scheduler-wizard.tsx
    stepper.tsx
  ui/
    mobile-cta.tsx
    site-header.tsx
    status-badge.tsx
    toast.tsx
lib/
  actions/
    booking-actions.ts
  data/
    seed.ts
  repositories/
    in-memory.ts
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
ADMIN_PASSWORD=admin123
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/alfa_barber
```

Observacao:
- `DATABASE_URL` e obrigatoria no ambiente.
- Defina `ADMIN_PASSWORD` forte em producao.

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
   - `ADMIN_PASSWORD`
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
- `POST /api/booking` -> cria agendamento
- `GET /api/admin/bookings` -> lista agendamentos (filtros opcionais)
- `PATCH /api/admin/bookings` -> atualiza status
- `GET /api/admin/blocked-slots` -> lista bloqueios
- `POST /api/admin/blocked-slots` -> cria bloqueio
- `DELETE /api/admin/blocked-slots?blockedSlotId=...` -> remove bloqueio

### Server Actions

- `createBookingAction`
- `updateBookingStatusAction`
- `createBlockedSlotAction`
- `deleteBlockedSlotAction`
- `adminLoginAction` / `adminLogoutAction`

## Fluxo de Teste (Manual)

1. Acesse `/agendar`.
2. Se nao estiver autenticado, faca login em `/cliente/login` ou cadastre em `/cliente/cadastro`.
3. Selecione servico e barbeiro.
4. Escolha data futura e horario disponivel.
5. Preencha/confira nome + telefone e confirme.
6. Valide redirecionamento para `/confirmacao?id=...`.
7. Acesse `/admin` e faca login com `ADMIN_PASSWORD`.
8. Confirme/cancele um agendamento.
9. Crie um bloqueio e veja o horario sumir no fluxo de agendamento.

## Observacoes Tecnicas

- O repositorio padrao esta em `lib/repositories/prisma.ts`.
- Cadastro/login de cliente persiste no banco com hash de senha.
- Conflitos sao barrados por sobreposicao de intervalo (`start/end`) considerando buffer.
