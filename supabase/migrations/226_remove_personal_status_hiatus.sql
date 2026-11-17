-- 226 — o status de LEITURA "Hiatus" (`personal_status.slug = 'hiatus'`) deixa de existir.
--
-- ✅ APLICADA na nuvem em 2026-11-16 (psql como `postgres`, ensaio com rollback antes). Movidas:
-- **0 obras** — ninguém estava com o status; só a opção saiu.
-- ORDEM DE DEPLOY: 226 → `npm run sync-constants` → código. O que NÃO pode ir antes dela são as
-- constantes regeneradas: sem "Hiatus" em `PERSONAL_STATUSES_BY_ID`, obras que ainda estivessem com
-- o id dele ficariam sem nome de status e sairiam da `/reading`.
--
-- POR QUE (decisão da Ana, 2026-11-16): hiato é fato da OBRA, e ele já tem casa —
-- `publication_status` "Hiatus" + `works.hiatus_kind`, que a `/reading` usa para o grupo "Em hiato"
-- (`isPracticalHiatus` cobre também a obra em andamento sem lançamento há 45 dias). Um status de
-- leitura com o mesmo nome dizia a mesma coisa pela pessoa, e podia discordar da publicação.
--
-- PARA ONDE VÃO as obras marcadas com ele: "Reading". Quem marcava Hiatus estava acompanhando uma
-- obra parada — continua acompanhando, e o hiato aparece pela publicação. Na `/reading` nada muda de
-- lugar (ela já pedia Reading + Hiatus); na `/my-list` as duas caíam na prateleira "Lendo".
-- ⚠️ O que MUDA: Reading é `is_following` e Hiatus não era — essas obras passam a contar no KPI
-- "acompanhando" do `/dashboard`.
--
-- `updated_at` NÃO pode mudar: a `/reading` usa `user_work_state.updated_at` como estimativa de
-- "última leitura" quando falta `last_read_at`, e carimbar agora jogaria essas obras para "lida
-- hoje". Nenhuma migration cria trigger em `user_work_state`, mas isso é o repo, não o banco — por
-- isso a conferência abaixo FALHA (e desfaz tudo) se o carimbo se mexer.
--
-- CÓPIA ANTES DE APAGAR: as duas tabelas `*_226` guardam a linha do status e as linhas movidas,
-- inteiras. Rollback em `scripts/rollback/226_rollback.sql`. Apagar as cópias quando a mudança
-- estiver verificada:
--   drop table if exists public.personal_status_hiatus_226;
--   drop table if exists public.user_work_state_hiatus_226;
--
-- IDEMPOTENTE: sem a linha 'hiatus', não faz nada.

create table if not exists public.personal_status_hiatus_226 as
  select * from public.personal_status where slug = 'hiatus';

create table if not exists public.user_work_state_hiatus_226 as
  select s.*
  from public.user_work_state s
  join public.personal_status p on p.id = s.personal_status_id
  where p.slug = 'hiatus';

-- ⚠️ `create table as` NÃO herda RLS nem grants, e a tabela nasce no `public`, que o PostgREST
-- expõe: sem isto a cópia (com nota e observações de leitura) ficaria legível pela API.
alter table public.personal_status_hiatus_226 enable row level security;
alter table public.user_work_state_hiatus_226 enable row level security;
revoke all on public.personal_status_hiatus_226 from anon, authenticated;
revoke all on public.user_work_state_hiatus_226 from anon, authenticated;

do $$
declare
  v_hiatus integer;
  v_reading integer;
  n_antes integer;
  n_copia integer;
  n_movidas integer;
  n_carimbo integer;
  n_restam integer;
begin
  select id into v_hiatus from public.personal_status where slug = 'hiatus';
  if v_hiatus is null then
    raise notice '226: personal_status ''hiatus'' já não existe — nada a fazer';
    return;
  end if;

  select id into v_reading from public.personal_status where slug = 'reading';
  if v_reading is null then
    raise exception '226: personal_status ''reading'' não existe — sem destino para as obras em Hiatus';
  end if;

  select count(*) into n_antes from public.user_work_state where personal_status_id = v_hiatus;
  select count(*) into n_copia from public.user_work_state_hiatus_226;
  if n_copia <> n_antes then
    raise exception '226: a cópia tem % linhas e o espelho tem % em Hiatus — cópia de outra execução?', n_copia, n_antes;
  end if;

  update public.user_work_state
     set personal_status_id = v_reading
   where personal_status_id = v_hiatus;
  get diagnostics n_movidas = row_count;
  if n_movidas <> n_antes then
    raise exception '226: movidas % de % linhas', n_movidas, n_antes;
  end if;

  select count(*) into n_carimbo
    from public.user_work_state s
    join public.user_work_state_hiatus_226 b using (user_id, work_id)
   where s.updated_at is distinct from b.updated_at;
  if n_carimbo > 0 then
    raise exception '226: updated_at mudou em % linhas (há trigger?) — a /reading leria como leitura de hoje', n_carimbo;
  end if;

  delete from public.personal_status where id = v_hiatus;

  select count(*) into n_restam from public.personal_status where slug = 'hiatus';
  if n_restam <> 0 then
    raise exception '226: o status hiatus continua na tabela';
  end if;

  raise notice '226: % obras foram de Hiatus para Reading; status hiatus (id %) removido', n_movidas, v_hiatus;
end $$;
