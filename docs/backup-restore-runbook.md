# Runbook de backup e restauração

## Estado verificado e lacunas

O projeto usa PostgreSQL/Supabase e Supabase Storage para a galeria. O repositório não prova plano, região, PITR, última execução bem-sucedida ou acesso atual aos backups. Confirme no painel antes de declarar cobertura.

Backups do banco Supabase não incluem os objetos do Storage; preservam os metadados, mas arquivos exigem cópia/restauração próprias. Uma restauração causa indisponibilidade. Banco e bucket `galeria` são componentes distintos.

## Objetivos propostos

- RPO provisório: 24 horas, somente após confirmar backups diários. Com PITR validado, alvo de 15 minutos.
- RTO: 4 horas para banco/aplicação; 8 horas para reconciliação da galeria.
- Retenção proposta: 30 dias de banco e cópia versionada de objetos, sujeita ao plano e à LGPD.

Sem evidência recente, o RPO é desconhecido — não assuma 24 horas.

## Verificação periódica sem restaurar produção

1. Registre projeto, região, plano, PITR, retenção e último backup concluído.
2. Verifique erros e capacidade do destino independente dos arquivos.
3. Inventarie quantidade/tamanho do bucket e compare à cópia versionada.
4. Mensalmente, restaure em projeto/PostgreSQL descartável autorizado.
5. Aplique o schema, rode integridade e testes sem chamar WhatsApp.
6. Valide referências da galeria contra a cópia de objetos.
7. Destrua o ensaio conforme política e guarde tempos, ponto restaurado e checks.

## Procedimento de incidente

1. Declare incidente, limite escritas se aprovado e preserve logs/auditoria.
2. Defina o ponto anterior à corrupção e a perda prevista.
3. Selecione backup/PITR e restaure preferencialmente em projeto novo, nunca no único banco de produção.
4. Valide migrações, contagens, chaves, agendamentos, sessões, outbox e auditoria. Mantenha `WHATSAPP_ENABLED=false` no teste.
5. Restaure/reconcilie Storage separadamente.
6. Faça cutover somente com aprovação, alvo revisado e plano de rollback.
7. Valide health/readiness e fluxos; habilite integrações só após autorização.
8. Registre RPO/RTO reais, lacunas e correções.

```sql
SELECT count(*) FROM "Booking";
SELECT "status", count(*) FROM "NotificationDelivery" GROUP BY "status";
SELECT max("createdAt") FROM "AuditLog";
SELECT "worker", "status", "lastRunAt", "lastSuccessAt" FROM "OperationalHeartbeat";
```

Não execute `DELETE`, `TRUNCATE`, replay, WhatsApp ou migração destrutiva como teste de restore.

## Backup separado do Storage

Use um destino versionado fora do mesmo projeto Supabase. Para cada execução:

1. liste os buckets e registre `project_ref`, bucket, quantidade de objetos, bytes totais e data de corte;
2. copie os objetos preservando bucket e caminho relativo, sem tornar objetos privados publicamente acessíveis;
3. gere um manifesto com caminho, tamanho, MIME, ETag quando disponível e SHA-256 calculado no destino;
4. armazene manifesto e objetos sob um prefixo imutável por data;
5. aplique retenção/versionamento no destino independente e monitore falhas de cópia;
6. reconcilie origem e destino por contagem, bytes e checksum; diferenças mantêm o gate em FAIL;
7. mensalmente restaure uma amostra e, trimestralmente, o bucket completo em projeto novo e isolado.

O bucket `barber` é o único bucket atualmente associado ao ALFA por configuração, mas o projeto remoto também contém `box`, `pdv` e `reviews-photos`. Não copie, altere ou reivindique esses buckets como parte do ALFA sem confirmação de propriedade. A estratégia torna o plano executável, mas seu estado permanece BLOCKED até existir destino, primeira cópia, manifesto validado e ensaio de restauração.
