-- 145_user_calculated_scores.sql
-- FATIA 2b — os scores derivados ganham DONO.
--
-- `calculated_scores` não tem `user_id`. Logo, a Nota Prevista, o Alinhamento, a Chance e o
-- personal_fit que estão lá são do DONO — e hoje aparecem para todo mundo como se fossem
-- deles. É o último vazamento: a Leitora lê "você vai gostar 8,6 disso" e aquilo é a previsão
-- do gosto DELE.
--
-- ── A linha que esta migration desenha ────────────────────────────────────────────────────
--
-- FATO DA OBRA (fica em `calculated_scores`, igual para todos — é o que o MAL mostra):
--   platform_avg, total_votes   → a NOTA DA COMUNIDADE (cobre 99% do catálogo, mediana 655 votos)
--   ia_eval, ia_eval_normalized → soma ponderada dos 9 atributos com os pesos GLOBAIS (curador)
--   chapters_normalized, formula_version, calculated_at
--
-- DE QUEM OLHA (vai para `user_calculated_scores`):
--   expected_score (+baseline/+quality_adj/+is_stub) → Ridge treinado nos RÓTULOS DELE
--   calc_score                                       → tem o ajuste de observação DELE dentro
--   chance_score, chance_is_stub                     → logística nos rótulos DELE
--   personal_fit, personal_fit_percentile, tag_overlap_net → perfil de gosto DELE
--   alignment_*                                      → Veredito por LLM (pago)
--   mae_calc, rmse_calc, confidence                  → métricas do modelo DELE
--
-- ⚠️ ADITIVA. Nada é dropado de `calculated_scores`: durante a transição ela segue sendo a
-- fonte do DONO (mesma decisão das Fatias 1 e 2a — o dono é imune, o espelho serve os outros).
-- O recalc passa a escrever nas duas.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/145_user_calculated_scores.sql

create table if not exists public.user_calculated_scores (
  user_id uuid not null,
  work_id uuid not null references public.works(id) on delete cascade,

  -- Nota Prevista (Ridge nos rótulos DELE) — determinística, custo ZERO de IA.
  expected_score numeric,
  expected_is_stub boolean not null default true,
  expected_baseline numeric,
  expected_quality_adj numeric,

  -- Nota.Calc (leva o ajuste de observação dele) e a Chance (Bússola).
  calc_score numeric,
  chance_score numeric,
  chance_is_stub boolean not null default true,

  -- Alinhamento por TAGS — sai do perfil DECLARADO (grátis) ou do INFERIDO por LLM (pago).
  personal_fit numeric,
  personal_fit_percentile numeric,
  tag_overlap_net numeric,

  -- Veredito IA — LLM, só para quem paga. Fica null pro Leitor free, e está certo.
  alignment_score numeric,
  alignment_run_id uuid,
  alignment_justification text,
  alignment_at timestamptz,
  alignment_payload jsonb,
  alignment_stale boolean not null default false,

  -- Métricas do modelo DELE (não do catálogo).
  mae_calc numeric,
  rmse_calc numeric,
  confidence numeric,

  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, work_id)
);

create index if not exists idx_ucs_work on public.user_calculated_scores (work_id);
create index if not exists idx_ucs_user_expected
  on public.user_calculated_scores (user_id, expected_score desc nulls last);

-- Backfill: tudo o que está em `calculated_scores` hoje é do DONO (a linha não tem dono, mas o
-- dado tem). Idempotente.
insert into public.user_calculated_scores (
  user_id, work_id,
  expected_score, expected_is_stub, expected_baseline, expected_quality_adj,
  calc_score, chance_score, chance_is_stub,
  personal_fit, personal_fit_percentile, tag_overlap_net,
  alignment_score, alignment_run_id, alignment_justification, alignment_at,
  alignment_payload, alignment_stale,
  mae_calc, rmse_calc, confidence, calculated_at
)
select
  (select current_user_id from public.user_settings order by created_at asc limit 1),
  cs.work_id,
  cs.expected_score, coalesce(cs.expected_is_stub, true), cs.expected_baseline, cs.expected_quality_adj,
  cs.calc_score, cs.chance_score, coalesce(cs.chance_is_stub, true),
  cs.personal_fit, cs.personal_fit_percentile, cs.tag_overlap_net,
  cs.alignment_score, cs.alignment_run_id, cs.alignment_justification, cs.alignment_at,
  cs.alignment_payload, coalesce(cs.alignment_stale, false),
  cs.mae_calc, cs.rmse_calc, cs.confidence, coalesce(cs.calculated_at, now())
from public.calculated_scores cs
on conflict (user_id, work_id) do nothing;

-- ── RLS: cada um só enxerga e só escreve as PRÓPRIAS linhas (mesmo padrão da mig 142).
-- O `with check` é o que impede escrever uma linha com o user_id de outra pessoa.
-- A service role ignora RLS — é ela que o recalc usa, com o user_id EXPLÍCITO.
alter table public.user_calculated_scores enable row level security;

grant select, insert, update, delete on public.user_calculated_scores to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_calculated_scores' and policyname='ucs_own_select') then
    create policy ucs_own_select on public.user_calculated_scores
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_calculated_scores' and policyname='ucs_own_insert') then
    create policy ucs_own_insert on public.user_calculated_scores
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_calculated_scores' and policyname='ucs_own_update') then
    create policy ucs_own_update on public.user_calculated_scores
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_calculated_scores' and policyname='ucs_own_delete') then
    create policy ucs_own_delete on public.user_calculated_scores
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on table public.user_calculated_scores is
  'Scores DERIVADOS per-usuário (Fatia 2b): Nota Prevista, Nota.Calc, Chance, Alinhamento, Veredito IA. O que fica em calculated_scores é FATO DA OBRA (platform_avg/total_votes = nota da comunidade, ia_eval = soma dos 9 atributos com os pesos globais). Os daqui saem dos RÓTULOS de cada um — e a Nota Prevista/Chance/personal_fit são DETERMINÍSTICOS (Ridge em TS, zero LLM), então o Leitor free tem direito a eles; o portão é DADO (MIN_TRAIN=20 rótulos), não plano. Só alignment_* é pago (LLM).';
