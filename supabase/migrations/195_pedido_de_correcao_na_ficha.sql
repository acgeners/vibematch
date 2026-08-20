-- ============================================================
-- 195 — o leitor passa a dizer O QUE está errado
-- ============================================================
-- A 177 criou o canal e já reservou a coluna `note`. Ela nunca foi escrita nem lida: em
-- 2026-08-20 os três tipos de pedido só sabiam pedir a REEXECUÇÃO de um pipeline
-- ("rebusque nas 9 fontes", "reavalie com IA"), e não havia como dizer "o ano está errado,
-- é 2019" ou "a capa é de outra obra".
--
-- 🔴 E essas são exatamente as correções que rebuscar NÃO conserta: ou a fonte externa
-- também está errada, ou o dado é de curadoria (título normalizado, tags, piso 18+, vínculo
-- de fonte). Pendurar a nota num `update_data` faria a fila do curador imprimir
-- "Rode 'Atualizar dados'" — a instrução que não resolve. Por isso o 4º tipo.
--
--   report_error — a ficha tem um erro. Nota OBRIGATÓRIA: sem ela o pedido é
--                  ininteligível ("tem algo errado" não é acionável).
--
-- Ele passa no mesmo teste dos outros três (ver cabeçalho da 177): nada em `works`
-- expressa "um leitor acha que este campo está errado".
-- ============================================================

set lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. O tipo novo
-- ------------------------------------------------------------
alter table public.curation_requests drop constraint if exists curation_requests_kind_check;
alter table public.curation_requests add constraint curation_requests_kind_check
  check (kind in ('update_data', 'review_eval', 'create_by_name', 'report_error'));

-- ------------------------------------------------------------
-- 2. A nota: teto no BANCO, não só na action
-- ------------------------------------------------------------
-- ⚠️ `createCurationRequest` é `"use server"`, ou seja endpoint HTTP público — quem GARANTE
-- é o banco. Sem teto, um POST à mão grava megabytes numa coluna que a fila do curador
-- renderiza.
--
-- 2000 é a folga de um parágrafo longo, na mesma ordem dos outros textos de usuário do app
-- (`user_settings.display_name` 80, `works.publication_status_note` 4000, review 5000).
--
-- 🔴 O teto é RECUSA, nunca truncamento — no app e aqui. Cortar texto por unidade UTF-16
-- parte emoji ao meio e deixa surrogate desemparelhado, que o Postgres recusa: foi o que
-- derrubou duas escritas em 18/08/2026 (ver `lib/text/pg-safe-text.ts`). Um check constraint
-- recusa a linha inteira, que é o comportamento certo.
alter table public.curation_requests drop constraint if exists curation_requests_note_tamanho;
alter table public.curation_requests add constraint curation_requests_note_tamanho
  check (note is null or (length(btrim(note)) between 1 and 2000));

-- Nota vazia é `null`, nunca string em branco: a UI decide "tem nota?" por `is not null`, e
-- um '' faria a fila desenhar um balão de citação sem citação nenhuma.

-- ------------------------------------------------------------
-- 3. `report_error` exige a nota
-- ------------------------------------------------------------
alter table public.curation_requests drop constraint if exists curation_requests_erro_tem_nota;
alter table public.curation_requests add constraint curation_requests_erro_tem_nota
  check (kind <> 'report_error' or (note is not null and length(btrim(note)) > 0));

-- ------------------------------------------------------------
-- 4. A dedup muda de chave — e é a parte que se paga caro se for esquecida
-- ------------------------------------------------------------
-- 🔴 A unicidade da 177 é `(user_id, work_id, kind)` e o app trata o 23505 como SUCESSO —
-- corretamente, porque para "rebusque esta obra" o estado desejado já vale e dizer "erro"
-- faria a pessoa clicar de novo.
--
-- Para `report_error` esse mesmo tratamento PERDE DADO: o segundo relato traz TEXTO
-- DIFERENTE. Com a chave antiga, quem achasse dois erros na mesma obra veria o toast
-- "pedido enviado" e o segundo texto não existiria em lugar nenhum — sem erro e sem log,
-- a família de defeito que este projeto documenta como a mais cara.
--
-- Logo: `report_error` sai da chave antiga e ganha uma que inclui a NOTA. Clicar duas vezes
-- com o mesmo texto continua idempotente (o 23505 segue certo); texto diferente é relato
-- diferente e entra.
drop index if exists curation_requests_aberto_por_obra_idx;
create unique index if not exists curation_requests_aberto_por_obra_idx
  on public.curation_requests (user_id, work_id, kind)
  where status = 'open' and work_id is not null and kind <> 'report_error';

-- `md5` porque o alvo é uma coluna de até 2000 caracteres: índice sobre o texto cru estoura
-- o limite de tamanho de entrada do btree. As três funções são IMMUTABLE, que é o que um
-- índice de expressão exige.
create unique index if not exists curation_requests_erro_aberto_idx
  on public.curation_requests (user_id, work_id, md5(lower(btrim(note))))
  where status = 'open' and kind = 'report_error';

comment on column public.curation_requests.note is
  'O que o leitor escreveu. Opcional em update_data/review_eval (qualifica o pedido), '
  'OBRIGATÓRIA em report_error (é o pedido inteiro). Teto de 2000 no check acima.';
