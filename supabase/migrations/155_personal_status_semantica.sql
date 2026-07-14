-- 155 — `personal_status` passa a guardar a SEMÂNTICA, não só o rótulo.
--
-- O problema que isto resolve: renomear "Completed" → "Finished" no Supabase quebrou 10 lugares do
-- código, e o TypeScript só pegou 6 — os outros eram strings soltas dentro de `Set`/array
-- (`new Set(["Completed", "Dropped"])`), que simplesmente PARAM DE CASAR em silêncio. As 74 obras
-- terminadas deixariam de disparar o formulário das 8 notas pós-leitura, de sumir do ranking e de
-- sair da fila de Interesse — sem um único erro.
--
-- A causa não foi descuido. O código nunca quis "o status chamado Completed"; ele quer CONCEITOS —
-- "a leitura acabou?", "leu tudo?", "faz sentido ter capítulo lido?". Como a tabela guardava só o
-- rótulo, cada tela reimplementou o conceito escrevendo o nome à mão. Duas cicatrizes disso:
--   · server/queries/ranking.ts filtrava por ["Finalizado","Droppado","Completed","Dropped"] —
--     português E inglês, chutando as duas grafias.
--   · work-form.tsx listava "Paused", um status que nunca existiu nesta tabela.
--
-- Com a semântica AQUI, o `sync-constants` a gera e o código pergunta `isTerminal(status)`.
-- Renomear vira operação de banco, sem efeito no código. É a regra do projeto: tudo que depende
-- de dado do Supabase entra por `sync-constants`.

alter table public.personal_status
  add column if not exists is_terminal        boolean not null default false,
  add column if not exists is_fully_read      boolean not null default false,
  add column if not exists tracks_progress    boolean not null default false,
  add column if not exists hide_from_interest boolean not null default false,
  add column if not exists sort_order         integer;

comment on column public.personal_status.is_terminal is
  'A leitura encerrou (concluiu ou desistiu). Dispara o formulário das 8 notas pós-leitura e oculta a obra do ranking.';
comment on column public.personal_status.is_fully_read is
  'Leu até o fim. Auto-preenche capítulos lidos = total e alimenta a auditoria de leitura.';
comment on column public.personal_status.tracks_progress is
  'Faz sentido ter capítulo lido neste status (o form mostra o campo de progresso).';
comment on column public.personal_status.hide_from_interest is
  'Não precisa de estimativa de Interesse — sai da fila do Avaliar.';
comment on column public.personal_status.sort_order is
  'Ordem de exibição (ciclo de leitura). Vem daqui, e não de uma lista de nomes no código.';

-- Casa por SLUG, não por id nem por nome: o slug é o que o `sync-constants` já usa como chave
-- estável, e o nome é justamente o que pode mudar (foi o que aconteceu).
update public.personal_status set
  is_terminal        = slug in ('finished', 'dropped'),
  is_fully_read      = slug in ('finished'),
  tracks_progress    = slug in ('finished', 'dropped', 'stalled', 'read_again',
                                'reading', 'started', 'on-hold', 'hiatus'),
  hide_from_interest = slug in ('finished', 'dropped', 'stalled', 'read_again');

-- `Read Again` (id 12, criado em 2026-07-12) é o status novo que o código ainda não conhecia.
-- Decisão: está RELENDO → tem progresso e sai da fila de Interesse (a obra já é conhecida), mas
-- NÃO é terminal (a leitura está em curso) nem "leu tudo" (o progresso desta releitura recomeçou).

-- ORDEM DE EXIBIÇÃO — a mesma doença, agora no próprio gerador.
--
-- `scripts/sync-constants.js` ordenava os status por uma lista de NOMES escrita à mão
-- (`PERSONAL_STATUS_ORDER = ["To read", "Reading", …, "Completed", …]`). Dois desses nomes não
-- existem mais na tabela, e 3 dos 11 status sequer estavam na lista: caíam em `indexOf === -1` e
-- iam parar no começo, em ordem arbitrária. O gerador que deveria curar o acoplamento ao nome
-- estava acoplado ao nome.
--
-- Ordem = ciclo de leitura (quero ler → comecei → lendo → travou → pausei → hiato → terminei →
-- relendo → larguei), com os "não-estados" (Not Now, Untracked) no fim.
update public.personal_status set sort_order = case slug
  when 'want-to-read' then 1
  when 'started'      then 2
  when 'reading'      then 3
  when 'stalled'      then 4
  when 'on-hold'      then 5
  when 'hiatus'       then 6
  when 'finished'     then 7
  when 'read_again'   then 8
  when 'dropped'      then 9
  when 'not_now'      then 10
  when 'untracked'    then 11
end;
