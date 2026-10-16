# Fase 2 — Performance, paginação e escalabilidade

## Diagnóstico confirmado

- A agenda administrativa e a agenda do barbeiro chamavam `listAdminBookings({})` e carregavam toda a tabela.
- O polling repetia a carga completa a cada 15 segundos, inclusive com a aba oculta, sem cancelamento ou backoff.
- Dashboard e ganhos calculavam totais filtrando todos os agendamentos em memória.
- A área do cliente carregava todo o histórico antes de separar futuros e passados.
- Bloqueios administrativos carregavam registros expirados sem limite.
- O contrato de listagem aceitava consultas sem período e sem limite.

## Contratos implantados

### `GET /api/admin/bookings`

- Autorização: sessão administrativa; o papel `BARBER` é sempre limitado ao próprio `barberId`.
- Parâmetros: `date` ou o par ISO `start`/`end`, `barberId`, `status`, `client`, `updatedAfter`, `cursor` e `limit`.
- Padrões: dia atual em `America/Porto_Velho` e 200 registros.
- Limites: no máximo 31 dias e 500 registros por página.
- Resposta: `data`, `nextCursor`, `hasMore`, `range` e `lastUpdatedAt`.
- Cache: `private, no-store`.
- Erros de validação: HTTP 400 com mensagem genérica.

### `GET /api/client/bookings`

- Autorização: sessão do cliente; o `clientId` vem exclusivamente da sessão.
- Parâmetros: `cursor` e `limit`.
- Padrões: 12 registros; máximo de 24.
- Ordenação: `dateTimeStart DESC, id DESC`.
- Resposta: `data`, `nextCursor` e `hasMore`.
- Cache: `private, no-store`.

## Consultas e limites

- Agenda: período visível de um dia, filtros no banco e limite explícito.
- Polling: três ciclos incrementais por `updatedAt` e um ciclo completo do período visível por minuto, removendo itens movidos para fora do dia ou do escopo sem voltar a consultar toda a tabela.
- Dashboard: `groupBy` de status, `count`, soma SQL parametrizada, taxa de ocupação por minutos reservados/capacidade, próximos 8 e últimos 7 registros.
- Ganhos: intervalo máximo de 366 dias, agregações SQL parametrizadas por dia, serviço e barbeiro, mais os últimos 20 recebimentos.
- Cliente: até 10 agendamentos futuros e histórico por cursor de 12 em 12.
- Bloqueios: somente ativos, ordenados e limitados a 100 (máximo interno 250).
- Serviços, barbeiros, galeria e disponibilidade: listas de configuração limitadas a 100. São conjuntos pequenos, cacheáveis e administrados; não justificam cursor na interface atual.
- Notificações: o worker já possuía `take` configurável, limitado a 100.
- Séries recorrentes: as consultas operacionais são limitadas pelo período finito da série e pelo máximo de ocorrências já validado.

## Índices preparados

Migration: `20260801140000_add_booking_query_indexes`.

| Índice | Consulta beneficiada | Custo e redundância |
| --- | --- | --- |
| `Booking_dateTimeStart_idx` | agenda sem filtro de barbeiro e agregações temporais | custo B-tree em inserções; não havia equivalente com esta coluna à esquerda |
| `Booking_clientId_dateTimeStart_idx` | próximos agendamentos e histórico do cliente | substitui `Booking_clientId_idx`, que fica redundante pelo prefixo esquerdo |
| `Booking_status_dateTimeStart_idx` | dashboard e filtros por status/período | substitui `Booking_status_idx` |
| `Booking_paymentStatus_dateTimeStart_idx` | ganhos por pagamento/período | substitui `Booking_paymentStatus_idx` |
| `Booking_updatedAt_idx` | polling incremental | custo adicional em toda atualização; necessário para evitar varredura completa |
| `BlockedSlot_barberId_dateTimeStart_dateTimeEnd_idx` | sobreposição por barbeiro e período | `dateTimeEnd` atua como filtro residual depois do range em início |

A cardinalidade e os planos reais devem ser verificados em homologação com `EXPLAIN (ANALYZE, BUFFERS)` antes da promoção. O banco configurado neste workspace é remoto e não foi usado para escrita ou criação de índices.

## Concorrência e sobreposição

As consultas existentes usam a condição correta: início existente menor que o fim solicitado e fim existente maior que o início solicitado. Criação e reagendamento usam transação `Serializable`, o que preserva a proteção concorrente atual.

Uma exclusion constraint com `tstzrange` e `btree_gist` não foi aplicada. Ela exige extensão, tratamento específico para agendamentos cancelados e validação do comportamento das séries. Deve ser avaliada separadamente em homologação; não é uma migration segura para introdução automática nesta fase.

## Cache

- Serviços, barbeiros e galeria mantêm cache público com TTL de 15 minutos e tags existentes.
- Agenda, histórico, dashboard, ganhos, disponibilidade, sessões, confirmação e pagamentos não receberam cache compartilhado.
- As APIs administrativas e do cliente enviam `private, no-store`.
- Nenhuma infraestrutura externa ou Realtime foi adicionada.

## Medição reproduzível

O banco configurado é remoto, portanto nenhuma carga ou medição foi executada nele. A comparação abaixo é uma simulação de serialização, não uma métrica de produção:

- registro representativo serializado: 705 bytes;
- comportamento anterior com 10.000 registros: aproximadamente 6,72 MiB por resposta;
- dia típico simulado com 20 registros: aproximadamente 13,77 KiB;
- polling incremental sem mudanças: 166 bytes no contrato simulado;
- frequência anterior: 4 cargas completas/minuto mesmo com aba oculta;
- frequência nova: 4 consultas incrementais/minuto com aba visível, 1/minuto oculta e backoff até 120 segundos após falhas.

Tempos de resposta e planos de execução permanecem pendentes de homologação com volume representativo.

## Ordem segura de homologação

1. Restaurar uma cópia sanitizada em PostgreSQL descartável ou homologação.
2. Aplicar as migrations com `prisma migrate deploy`.
3. Confirmar que `Booking.updatedAt` existe e é atualizado pelas mutações Prisma.
4. Rodar os testes e o build contra homologação.
5. Medir as consultas principais com `EXPLAIN (ANALYZE, BUFFERS)` e revisar o Index Advisor.
6. Somente depois promover migration e aplicação na ordem prevista pelo processo de deploy.
