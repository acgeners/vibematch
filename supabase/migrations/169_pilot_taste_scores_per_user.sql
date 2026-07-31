-- ============================================================
-- 169 — pilot_taste_scores vira PER-USER (destrave da nota do usuário, Bloco 01)
-- ============================================================
-- A tabela nasceu single-user na 133 ("Single-user (work_id é PK) — coerente com o
-- modelo atual") e virou o CAMINHO DA NOTA: os 7 eixos de gosto derivam o `user_score`
-- que treina a Nota Prevista. Enquanto work_id for PK, um segundo usuário que avalie
-- uma obra já avaliada SOBRESCREVE a linha do dono — sem erro, sem log (o mesmo padrão
-- do índice único global que mordeu na Fase 2).
--
-- O que muda:
--   1. `user_id uuid not null` (backfill: todo o dado atual é do DONO — a linha
--      singleton mais antiga de user_settings, mesmo critério da 138).
--   2. PK deixa de ser (work_id) e vira (user_id, work_id) — igual user_work_state.
--   3. GRANT + políticas RLS `user_id = auth.uid()` (padrão da 142): o cliente de
--      sessão (`createUserClient`) só enxerga/escreve as PRÓPRIAS linhas; a service
--      role (curadoria/scripts) segue passando por cima, com user_id explícito.
--
-- ⚠️ ACOPLADA AO DEPLOY: o código antigo upserta com `onConflict: "work_id"`, que
-- deixa de ter unique após a troca da PK; o código novo usa `"user_id,work_id"`, que
-- não existe antes dela. Aplicar a migration e publicar o código JUNTOS.
--
-- ⚠️ ROLLBACK (só é válido ENQUANTO houver 1 usuário na tabela — com um segundo
-- usuário avaliando, voltar a PK(work_id) exigiria descartar linhas):
--   ver scripts/rollback/169_rollback.sql (ensaiado no Postgres local antes de aplicar).
-- ============================================================

-- Desiste em vez de disputar lock com o app (lição da 142).
set lock_timeout = '5s';

-- 1) Coluna user_id + backfill pro dono ─────────────────────────────────────
alter table public.pilot_taste_scores add column if not exists user_id uuid;

update public.pilot_taste_scores
   set user_id = (
     select current_user_id from public.user_settings
      order by created_at asc limit 1
   )
 where user_id is null;

alter table public.pilot_taste_scores alter column user_id set not null;

-- 2) PK (user_id, work_id) ──────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.pilot_taste_scores'::regclass
       and contype = 'p'
       and conname = 'pilot_taste_scores_pkey'
       and (select array_agg(attname::text order by attnum)
              from pg_attribute
             where attrelid = 'public.pilot_taste_scores'::regclass
               and attnum = any (conkey)) = array['work_id']
  ) then
    alter table public.pilot_taste_scores drop constraint pilot_taste_scores_pkey;
    alter table public.pilot_taste_scores add primary key (user_id, work_id);
  end if;
end $$;

-- 3) GRANT + políticas RLS (padrão da 142; RLS já está ligada desde a 133) ──
grant select, insert, update, delete on public.pilot_taste_scores to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'pilot_taste_scores'
                    and policyname = 'pilot_taste_scores_own_select') then
    create policy pilot_taste_scores_own_select on public.pilot_taste_scores
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'pilot_taste_scores'
                    and policyname = 'pilot_taste_scores_own_insert') then
    create policy pilot_taste_scores_own_insert on public.pilot_taste_scores
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'pilot_taste_scores'
                    and policyname = 'pilot_taste_scores_own_update') then
    create policy pilot_taste_scores_own_update on public.pilot_taste_scores
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename = 'pilot_taste_scores'
                    and policyname = 'pilot_taste_scores_own_delete') then
    create policy pilot_taste_scores_own_delete on public.pilot_taste_scores
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

comment on table public.pilot_taste_scores is
  'Notas de gosto por USUÁRIO (per-user desde a 169; era o experimento single-user da 133). 1 linha/(user_id, work_id); 7 eixos derivam o user_score. RLS: cada usuário só vê/escreve as próprias linhas; service role ignora.';
comment on column public.pilot_taste_scores.user_id is
  'Dono da avaliação (= auth.uid()). Backfill da 169: todo o dado pré-existente é do dono do catálogo (singleton mais antigo de user_settings).';
