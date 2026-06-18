-- ============================================================
-- 106 — ranking_strategy_snapshots (SHADOW ranking / comparação prospectiva)
-- ============================================================
-- Camada ADITIVA sobre prediction_snapshots (105). NÃO altera o ranking visível.
--
-- Em cada recomendação calculamos VÁRIAS estratégias de ordenação sobre EXATAMENTE
-- o mesmo conjunto de obras prospectivas (sem user_score) daquela run. Só a
-- estratégia exibida (displayed_current) é mostrada ao usuário; as demais ficam
-- guardadas silenciosamente (shadow mode) pra serem comparadas DEPOIS, quando as
-- obras receberem nota real (resolvidas em prediction_snapshots).
--
-- Cada linha = (snapshot da obra) × (estratégia × versão). O work_id vive em
-- prediction_snapshots: dentro de uma run, cada obra tem 1 snapshot e TODAS as
-- estratégias daquela obra referenciam o MESMO prediction_snapshot_id — logo o
-- subconjunto comum entre duas estratégias é o conjunto comum de
-- prediction_snapshot_id elegíveis em ambas. O actual_user_score vem do join.
--
-- Imutável por construção (igual ao 105): nunca sobrescrevemos uma linha. A
-- captura é best-effort (falha não bloqueia a recomendação) e idempotente por
-- (prediction_snapshot_id, strategy_key, strategy_version).
--
-- Versionamento: qualquer mudança em fórmula/peso/desempate/tratamento de
-- null/mood/tiers de uma estratégia exige BUMP de strategy_version (ex.: v1→v2),
-- nunca reescrita — os resultados históricos permanecem comparáveis.
--
-- RLS ligado sem policy (anon bloqueado; service role ignora RLS) — igual ao
-- resto do schema.
-- ============================================================

create table if not exists ranking_strategy_snapshots (
  id                       uuid primary key default gen_random_uuid(),

  -- Obra/contexto: a identidade da obra dentro da run vive aqui. ON DELETE CASCADE
  -- garante que apagar um snapshot prospectivo leva junto suas estratégias-sombra.
  prediction_snapshot_id   uuid not null
    references prediction_snapshots(id) on delete cascade,

  -- Agrupa as obras de UMA execução de ranking (= recommendation_runs.id).
  -- Métricas de ordenação são SEMPRE calculadas dentro de um mesmo grupo.
  ranking_snapshot_id      uuid not null,

  strategy_key             text not null,
  strategy_version         text not null,

  -- Resultado da estratégia pra esta obra. rank_position 1-based (1 = topo).
  -- strategy_score = valor de ordenação quando a estratégia tem um escalar
  -- (calc/expected/decision/personal_fit/alignment); null pra ordenações que só
  -- têm posição (displayed_current/mood_within_tier — a ordem É o sinal).
  rank_position            integer,
  tier                     integer,
  strategy_score           numeric,

  -- Obra inelegível pra esta estratégia (ex.: valor ausente) → eligible=false +
  -- motivo obrigatório. Distingue "inelegível" de "linha ausente" e de "null".
  eligible                 boolean not null default true,
  exclusion_reason         text,

  -- Marca a única estratégia realmente exibida ao usuário naquela run.
  is_displayed_strategy    boolean not null default false,

  captured_at              timestamptz not null default now(),

  unique (
    prediction_snapshot_id,
    strategy_key,
    strategy_version
  ),

  constraint ranking_strategy_rank_positive
    check (rank_position is null or rank_position > 0),
  constraint ranking_strategy_tier_positive
    check (tier is null or tier > 0),
  -- inelegível obriga motivo; elegível não precisa (mas pode ter rank/score).
  constraint ranking_strategy_eligible_reason
    check (eligible = true or exclusion_reason is not null)
);

-- Índices só pros acessos reais das métricas:
--  (ranking_snapshot_id, strategy_key, strategy_version) → agrupar por run+estratégia.
--  (prediction_snapshot_id)                              → join/resolução por obra.
create index if not exists ranking_strategy_snapshots_group_idx
  on ranking_strategy_snapshots (ranking_snapshot_id, strategy_key, strategy_version);
create index if not exists ranking_strategy_snapshots_prediction_idx
  on ranking_strategy_snapshots (prediction_snapshot_id);

alter table ranking_strategy_snapshots enable row level security;

comment on table ranking_strategy_snapshots is
  'Shadow ranking: várias estratégias de ordenação sobre o mesmo conjunto prospectivo de uma run (aditivo a prediction_snapshots/105). Só displayed_current é exibida; as demais ficam pra comparação prospectiva quando as obras forem avaliadas. AUDIT_REPORT P1 (F5/F6/F7/F8).';
