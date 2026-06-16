-- ============================================================
-- 100 — user_tag_preferences (Item A: tags declaradas amo/evito)
-- ============================================================
-- Stance declarada pelo usuário em qualquer nível da hierarquia
-- Grupo → Subgrupo → Tag (tag_group / tag_subgroup / tags — relação
-- já existe e está populada: 21 grupos → 83 subgrupos → ~1455 tags).
--
-- Serve como PRIOR pro perfil de gosto (taste-profile-heuristic, via
-- shrinkage λ=n/(n+k)) e como filtro/boost no ranking. Per-user-ready
-- (multi-user vindo); hoje user_id = singleton de user_settings.
-- Precedência na leitura: tag > subgrupo > grupo (o mais específico vence).
--
-- "neutro" = ausência de linha. weight 1–2 = força da declaração (vira
-- a strength do prior no merge).
-- ============================================================

create table if not exists user_tag_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  tag_id          uuid references tags(id)         on delete cascade,
  tag_subgroup_id uuid references tag_subgroup(id) on delete cascade,
  tag_group_id    uuid references tag_group(id)    on delete cascade,
  stance          text not null check (stance in ('love','avoid')),
  weight          numeric(3,2) not null default 1.0 check (weight > 0 and weight <= 2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- exatamente UM alvo entre tag / subgrupo / grupo
  constraint utp_one_target check (
    (tag_id is not null)::int
  + (tag_subgroup_id is not null)::int
  + (tag_group_id is not null)::int = 1
  )
);

-- uma stance por alvo por usuário (partial unique por tipo de alvo)
create unique index if not exists utp_user_tag_uniq
  on user_tag_preferences (user_id, tag_id) where tag_id is not null;
create unique index if not exists utp_user_subgroup_uniq
  on user_tag_preferences (user_id, tag_subgroup_id) where tag_subgroup_id is not null;
create unique index if not exists utp_user_group_uniq
  on user_tag_preferences (user_id, tag_group_id) where tag_group_id is not null;
create index if not exists utp_user_idx on user_tag_preferences (user_id);

-- RLS on, sem policy permissiva (convenção do repo: anon bloqueado,
-- service role bypassa). Igual às demais tabelas.
alter table user_tag_preferences enable row level security;

comment on table user_tag_preferences is
  'Preferências declaradas (amo/evito) em Grupo/Subgrupo/Tag — prior pro perfil de gosto (shrinkage) + filtro/boost no ranking. Item A.';
