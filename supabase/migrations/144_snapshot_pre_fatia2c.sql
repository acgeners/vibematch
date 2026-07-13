-- 144_snapshot_pre_fatia2c.sql
--
-- REDE DE SEGURANÇA no próprio banco, antes de desatrelar o dado pessoal de `works`
-- (Fatia 2c). Cópia literal de 3 tabelas, congelada no corte.
--
-- Por que dentro do banco, se já existe o `backup-db.mjs`? Porque na hora do aperto os dois
-- servem a coisas diferentes:
--
--   .backups/*.ndjson.gz  → sobrevive à morte do projeto, mas restaurar exige um script,
--                           upsert linha a linha, e ordem de FK. É a rede LONGA.
--   estas tabelas         → restauram com UM `update … from`, em segundos, sem upload e sem
--                           script pra dar errado. É a rede CURTA — a que se usa quando um
--                           backfill acabou de escrever besteira em 882 linhas.
--
-- ⚠️ O que elas NÃO cobrem: schema (índices, triggers, políticas de RLS) e `auth.users`. E
-- morrem junto com o projeto, porque moram nele. Não substituem o dump — somam.
--
-- Snapshot do dia 2026-07-13, ANTES da Fatia 2c:
--   works              → as 16 colunas pessoais ainda vivem aqui (é o que a 2c vai desatrelar)
--   user_work_state    → o espelho, que vira a fonte de verdade
--   calculated_scores  → as 878 Nota Prevista. É contra ESTA cópia que a 2c é testada: o
--                        recalc, depois de religado, tem que devolver os MESMOS números. Se
--                        uma se mexer, o Ridge passou a treinar com o dado errado.
--
-- APAGAR quando a Fatia 2 estiver fechada e verificada:
--   drop table if exists public.works_snapshot_20260713;
--   drop table if exists public.user_work_state_snapshot_20260713;
--   drop table if exists public.calculated_scores_snapshot_20260713;

create table if not exists public.works_snapshot_20260713 as
  select * from public.works;

create table if not exists public.user_work_state_snapshot_20260713 as
  select * from public.user_work_state;

create table if not exists public.calculated_scores_snapshot_20260713 as
  select * from public.calculated_scores;

-- ⚠️ `create table as` NÃO herda RLS nem grants — e a tabela nasce no schema `public`, que é
-- o que o PostgREST expõe. Sem as duas linhas abaixo, um snapshot com a NOTA, as OBSERVAÇÕES
-- e o histórico de leitura do dono ficaria legível pela API. Um backup não pode ser um
-- vazamento.
alter table public.works_snapshot_20260713             enable row level security;
alter table public.user_work_state_snapshot_20260713   enable row level security;
alter table public.calculated_scores_snapshot_20260713 enable row level security;

revoke all on public.works_snapshot_20260713             from anon, authenticated;
revoke all on public.user_work_state_snapshot_20260713   from anon, authenticated;
revoke all on public.calculated_scores_snapshot_20260713 from anon, authenticated;

comment on table public.works_snapshot_20260713 is
  'SNAPSHOT 2026-07-13, antes da Fatia 2c (desatrelar o dado pessoal de works). Rede CURTA de restauração: update … from. Apagar quando a Fase 2 fechar.';

-- Confere: as três contagens têm que bater com as originais.
--   select
--     (select count(*) from public.works)                    as works,
--     (select count(*) from public.works_snapshot_20260713)  as works_snap,
--     (select count(*) from public.calculated_scores)        as calc,
--     (select count(*) from public.calculated_scores_snapshot_20260713) as calc_snap;
--
-- Restaurar as colunas pessoais de works (o caso de uso real):
--   update public.works w set
--     user_score = s.user_score, observations = s.observations,
--     synopsis_quality = s.synopsis_quality, is_favorite = s.is_favorite,
--     personal_status_id = s.personal_status_id, chapters_read = s.chapters_read,
--     last_read_at = s.last_read_at
--   from public.works_snapshot_20260713 s where s.id = w.id;
