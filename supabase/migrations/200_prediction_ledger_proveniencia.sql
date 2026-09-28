-- ============================================================
-- 200 — prediction_ledger: componentes da previsão + PROVENIÊNCIA da captura
-- ============================================================
-- ⚠️ PREPARADA, NÃO APLICADA. Aplicar exige autorização explícita.
--
-- Por que: o ledger (mig 101) guardava só `predicted_expected`/`predicted_decision`. Para
-- medir depois QUAL componente acertou (Nota Prevista × Nota.Calc × Alinhamento) sem
-- reconstrução histórica, ele passa a congelar também `calc` e `personal_fit`, lidos no MESMO
-- instante — imediatamente ANTES de a primeira nota ser gravada.
--
-- E a captura deixa de poder falhar em silêncio: `capture_status` distingue
--   captured       → havia previsão utilizável para o usuário naquele momento;
--   no_prediction  → indisponível LEGITIMAMENTE (obra criada já com nota; recalc ainda não
--                    produziu `expected_score` — ex.: sem os atributos);
--   failed         → a leitura da previsão falhou (`capture_error` diz por quê).
-- "Captura não tentada" continua sendo AUSÊNCIA de linha para uma obra avaliada — é o que
-- sobra dos caminhos que escrevem nota fora do app (scripts, SQL direto).
--
-- ADITIVA: todas as colunas nullable, sem backfill. Linhas antigas ficam com
-- capture_status NULL = "anterior à migration 200" (proveniência desconhecida, não "falhou").
--
-- ORDEM DE DEPLOY: esta migration ANTES do código que escreve as colunas. O código tolera a
-- ausência (cai no formato legado e avisa uma vez), então a ordem inversa não quebra a nota —
-- só perde os campos novos até a migration entrar.
-- ============================================================

set lock_timeout = '5s';

alter table public.prediction_ledger
  add column if not exists predicted_calc numeric,
  add column if not exists predicted_personal_fit numeric,
  add column if not exists predicted_personal_fit_percentile numeric,
  add column if not exists prediction_calculated_at timestamptz,
  add column if not exists capture_status text,
  add column if not exists capture_source text,
  add column if not exists capture_error text;

alter table public.prediction_ledger
  drop constraint if exists prediction_ledger_capture_status_check;
alter table public.prediction_ledger
  add constraint prediction_ledger_capture_status_check
  check (capture_status is null or capture_status in ('captured', 'no_prediction', 'failed'));

comment on column public.prediction_ledger.predicted_calc is
  'Nota.Calc (user_calculated_scores.calc_score) lida imediatamente ANTES da 1ª nota. NULL = indisponível (ver capture_status).';
comment on column public.prediction_ledger.predicted_personal_fit is
  'personal_fit (0–1) lido imediatamente ANTES da 1ª nota.';
comment on column public.prediction_ledger.predicted_personal_fit_percentile is
  'Alinhamento exibido (percentil 0–100) lido imediatamente ANTES da 1ª nota.';
comment on column public.prediction_ledger.prediction_calculated_at is
  'calculated_at da linha de user_calculated_scores usada — prova de que a previsão é anterior à nota.';
comment on column public.prediction_ledger.capture_status is
  'captured | no_prediction | failed. NULL = linha anterior à migration 200.';
comment on column public.prediction_ledger.capture_source is
  'Caminho de escrita que produziu a 1ª nota (ex.: writeReadingState, mirrorOwnerState).';
comment on column public.prediction_ledger.capture_error is
  'Mensagem do erro quando capture_status = failed.';
