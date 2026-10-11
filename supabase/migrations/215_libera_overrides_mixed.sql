-- 215 — Libera 5 dos 6 `adult_override = true` das obras `mixed` (fase 2), com histórico
--
-- 🔴 NÃO APLICADA. APLICAR SÓ DEPOIS DO DEPLOY DA FASE 2 E DO RECÁLCULO NA NUVEM (o seletor de edição,
-- o filtro de leitura por edição e a Nota Prevista por edição). Antes disso a página mostra a nota/tags/avisos da R18 a quem oculta 18+, que é
-- exatamente o motivo de os 6 terem ficado ocultos na fase 1. A ordem inverte a usual: CÓDIGO antes
-- desta migration.
--
-- Critério fechado (decisão 14 da fase 2), conferido aqui por obra no que o banco consegue ver:
--   · obra `mixed`;
--   · nota da normal COM procedência em `work_edition_scores` (qualquer fonte que não `not_rated` —
--     o baseline 5,0 provisório conta: ele É a nota da normal, com procedência explícita);
--   · override ainda `true` (decisão de quem o pôs não é reescrita duas vezes);
--   · nenhuma evidência independente de que a normal, por si, ligue o gate (a auditoria das 6 as
--     classificou `r18_version_only`/`legacy_work_level`; tag forte é exclusiva da R18 na régua de
--     edição, então a versão normal não exibe nenhuma).
-- O que o banco NÃO vê (versão normal selecionável; dados exclusivos da R18 fora da normal) é o código
-- da fase 2 — daí a ordem acima. ⚠️ NÃO se exige nota < 9: nota e gate são dimensões separadas.
--
-- O sexto override (One Last Night With My Soon-To-Be Ex-husband) FICA: foi posto por um humano pela
-- UI com as duas versões à vista e o motivo é desconhecido (auditoria `inconclusive`). Desfazê-lo é
-- decisão dela, não desta migration.
--
-- `adult_override` volta a NULL ⇒ `is_adult` segue o estado de edição (`mixed` ⇒ false): a obra aparece
-- para quem oculta 18+, pela versão normal. Cada troca vai para `work_adult_override_log`.
-- ROLLBACK: `scripts/rollback/215_rollback.sql`.

set lock_timeout = '5s';

create table if not exists public.work_adult_override_log (
  id          bigserial primary key,
  work_id     uuid not null references public.works(id) on delete cascade,
  old_value   boolean,
  new_value   boolean,
  reason      text not null,
  evidence    jsonb not null default '{}'::jsonb,
  decided_by  text not null,
  created_at  timestamptz not null default now()
);
comment on table public.work_adult_override_log is
  'Histórico de trocas de works.adult_override feitas por migration/curadoria, com o motivo. Migration 215.';
alter table public.work_adult_override_log enable row level security;

drop table if exists pg_temp.mig215_dados;
create temp table mig215_dados on commit drop as
  select * from jsonb_to_recordset($dados$[
{"classificacao": "override_r18_version_only", "titulo": "A Breath in the End of Verdure", "work_id": "b0fe0d03-55a9-4a62-a092-145eab2e58b1"},
{"classificacao": "override_legacy_work_level", "titulo": "Kill This Marriage", "work_id": "0907dc04-99c0-4393-b2b8-d9663b07d356"},
{"classificacao": "override_r18_version_only", "titulo": "My Husband Is Definitely a Paladin", "work_id": "2d8cb9ce-78ef-4b0c-a1e4-4662146ffb55"},
{"classificacao": "override_r18_version_only", "titulo": "The Sweet Savior of the Immoral Beast", "work_id": "4d6e8e8a-608e-403a-b53e-afa214e6b482"},
{"classificacao": "override_r18_version_only", "titulo": "The Wolf Who Tempted the Black Serpent", "work_id": "c01b9720-f162-4d35-bf99-3a2c34a09adc"}
]$dados$::jsonb) as x(work_id uuid, classificacao text, titulo text);

create schema if not exists bkp;
create table if not exists bkp.mig215_works_antes as
  select w.id, w.adult_override, w.is_adult from public.works w join pg_temp.mig215_dados d on d.work_id = w.id;

do $m$
declare n_ok int; n int;
begin
  -- Critério por obra, no banco: mixed + normal com procedência + override ainda true (ou já liberado
  -- por esta migration — reexecução).
  select count(*) into n_ok from pg_temp.mig215_dados d
    join public.works w on w.id = d.work_id
    join public.work_edition_scores s on s.work_id = d.work_id and s.edition = 'normal' and s.criterion_slug = 'adult_content'
   where w.edition_state = 'mixed' and s.source <> 'not_rated' and s.score is not null
     and (w.adult_override is true or exists (select 1 from public.work_adult_override_log l where l.work_id = d.work_id and l.evidence->>'mig' = '215'));
  if n_ok <> 5 then
    raise exception 'mig 215: só % de 5 obras passam no critério (mixed + normal com procedência) — abortando', n_ok;
  end if;
  -- One Last Night não está na lista e não pode sair por acidente.
  if exists (select 1 from pg_temp.mig215_dados where work_id = '8719d6a0-b7ee-45ea-ba61-7cbaaf6d185d') then
    raise exception 'mig 215: One Last Night não pode estar na lista — abortando';
  end if;
  insert into public.work_adult_override_log (work_id, old_value, new_value, reason, evidence, decided_by)
  select d.work_id, true, null,
         'fase 2 de mixed: a versão normal passou a ser representável (nota com procedência e filtro de leitura por edição)',
         jsonb_build_object('mig', '215', 'classificacao_auditoria', d.classificacao,
                            'nota_normal', (select jsonb_build_object('score', s.score, 'source', s.source, 'status', s.status)
                                              from public.work_edition_scores s
                                             where s.work_id = d.work_id and s.edition = 'normal' and s.criterion_slug = 'adult_content')),
         'curator'
    from pg_temp.mig215_dados d join public.works w on w.id = d.work_id
   where w.adult_override is true;
  update public.works w set adult_override = null
    from pg_temp.mig215_dados d where w.id = d.work_id and w.adult_override is true;
  select count(*) into n from pg_temp.mig215_dados d join public.works w on w.id = d.work_id
   where w.adult_override is null and w.is_adult is false;
  if n <> 5 then
    raise exception 'mig 215: depois da troca só % de 5 ficaram visíveis (is_adult = false) — abortando', n;
  end if;
  if not exists (select 1 from public.works where id = '8719d6a0-b7ee-45ea-ba61-7cbaaf6d185d' and adult_override is true) then
    raise exception 'mig 215: One Last Night perdeu o override — abortando';
  end if;
end
$m$;
