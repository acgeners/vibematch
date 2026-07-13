-- 150_works_owner_view.sql
-- FASE C — os últimos consumidores param de ler o dado pessoal de `works`.
--
-- Sobraram 11 arquivos / 26 queries lendo `works.user_score`, `works.post_*`, `works.observations`
-- e cia.: calibração, sugestão de pesos, recomendação, deep dive, piloto, ledger de previsões,
-- métricas do /settings, dashboard, readiness. São todos consumidores do dado DO DONO — e por
-- isso estão CERTOS hoje (o espelho está em sincronia desde a Fase A). Mas enquanto eles lerem
-- `works`, o `DROP COLUMN` é impossível.
--
-- ── Por que uma VIEW, e não 26 reescritas ─────────────────────────────────────────────────
--
-- Porque 26 filtros SQL reescritos à mão são 26 chances de errar em silêncio — e o erro aqui
-- não faz barulho: `.not("user_score", "is", null)` num lugar onde o dado sumiu devolve ZERO
-- linhas, e a calibração "roda com sucesso" sobre um conjunto vazio.
--
-- A view expõe EXATAMENTE os mesmos nomes de coluna, mas as pessoais vêm de `user_work_state`
-- (a linha do DONO). Cada consumidor troca UMA PALAVRA — `from("works")` → `from("works_owner")`
-- — e todo o resto (filtros, ordenações, contagens) continua valendo, sem tradução.
--
-- E o dia do `DROP COLUMN` fica trivial: a view já não depende das colunas de `works`.
--
-- ⚠️ Um backup não pode virar vazamento, e uma view também não. `create view` NÃO herda RLS —
-- e ela nasce no schema `public`, que é o que o PostgREST expõe. Sem o `revoke`, a nota, as
-- observações e o histórico de leitura do dono ficariam legíveis pela API. Só a service role lê.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/150_works_owner_view.sql

create or replace view public.works_owner as
select
  w.id,
  w.title,
  w.original_title,
  w.alternative_titles,
  w.year,
  w.year_end,
  w.total_chapters,
  w.publication_status_id,
  w.ai_eval_status,
  w.is_archived,
  w.canonical_synopsis,
  w.created_at,
  w.updated_at,
  w.data_refreshed_at,
  w.tags_inferred_at,

  -- ── As 16 pessoais: do ESPELHO DO DONO, não de `works`.
  -- `coalesce` nos not-null pra uma obra recém-criada que ainda não tem linha no espelho se
  -- comportar como sempre (favorito falso, ajuste zero) — e não virar NULL onde o código
  -- espera um valor.
  coalesce(s.is_favorite, false)                as is_favorite,
  s.personal_status_id,
  s.chapters_read,
  s.last_read_at,
  s.user_score,
  s.observations,
  coalesce(s.observation_adjustment, 0)         as observation_adjustment,
  s.synopsis_quality,
  coalesce(s.synopsis_quality_source, 'legacy_unknown') as synopsis_quality_source,
  s.synopsis_quality_prediction_id,
  coalesce(s.synopsis_interest_skipped, false)  as synopsis_interest_skipped,
  s.post_story_score,
  s.post_fl_score,
  s.post_ml_score,
  s.post_character_development_score,
  s.post_pacing_score,
  s.post_art_visual_score,
  s.post_impact_immersion_score,
  s.post_originality_score
from public.works w
left join public.user_work_state s
  on s.work_id = w.id
 and s.user_id = (select current_user_id from public.user_settings order by created_at asc limit 1);

revoke all on public.works_owner from anon, authenticated;

comment on view public.works_owner is
  'FASE C: `works` com as 16 colunas PESSOAIS vindas do espelho do DONO (user_work_state), não da linha compartilhada. Existe pra os consumidores do dado do dono (calibração, pesos, recomendação, deep dive, piloto, ledger, métricas, dashboard) trocarem UMA PALAVRA em vez de 26 filtros SQL — reescrever filtro à mão é onde se erra em silêncio: um `.not(user_score is null)` sobre coluna vazia devolve ZERO linhas, e a calibração "roda com sucesso" sobre nada. Depois do DROP das colunas de works, a view segue funcionando. NÃO é exposta pela API (revoke).';
