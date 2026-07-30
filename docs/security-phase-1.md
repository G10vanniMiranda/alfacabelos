# Fase 1 de segurança

## Modelo de acesso ao banco

A aplicação usa sessões opacas próprias e Prisma no backend. As roles `anon` e
`authenticated` do Supabase não são uma API de dados da aplicação. A migration
`20260730120000_lock_down_future_public_privileges` remove dessas roles, e de
`PUBLIC`, privilégios automáticos em novas tabelas, sequências e funções criadas
pela role `postgres`.

`service_role` não é revogada: ela permanece disponível para operações
privilegiadas do backend, como Storage. A chave correspondente continua sendo
exclusivamente server-side e nunca deve usar prefixo `NEXT_PUBLIC_`.

Para validar em staging, aplique primeiro as migrations com a conexão direta e
crie objetos temporários com a role `postgres`. Confirme com `has_table_privilege`,
`has_sequence_privilege` e `has_function_privilege` que `anon`,
`authenticated` e `PUBLIC` não recebem acesso, enquanto a conexão Prisma e as
operações server-side que usam `service_role` continuam funcionais. Remova os
objetos temporários após a validação.

Não aplique esta migration diretamente em produção sem backup, janela de
mudança e validação prévia em staging.

## Upload de mídia

O servidor valida tamanho, MIME declarado, extensão única e assinatura do
conteúdo antes de persistir. SVG e demais formatos fora da allowlist são
rejeitados. O envio ao Storage e o fallback local não criam uma segunda cópia
integral do arquivo na aplicação.

O limite de entrada de Server Actions permanece em 6 MB. Portanto, o limite de
50 MB exibido para vídeos exige, numa fase posterior, upload direto ao Storage
com URL assinada curta, validação pós-upload e promoção do objeto. Aumentar o
buffer global da Server Action não é recomendado.

## Rotação de senha administrativa

Qualquer alteração de senha remove todas as linhas de `AdminSession` ligadas ao
acesso, inclusive a sessão que iniciou a mudança quando ela pertence ao mesmo
usuário. Cookies antigos podem permanecer no navegador, mas deixam de
autenticar imediatamente. Um novo login cria uma nova sessão.
