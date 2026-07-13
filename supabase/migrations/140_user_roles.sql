-- 140_user_roles.sql — Papéis de usuário (Curador / Assinante / Leitor)
--
-- Aplicar À MÃO no SQL editor do Supabase (o CLI está dessincronizado neste projeto).
--
-- CONTEXTO
-- Até aqui o acesso vinha de DOIS campos independentes: `user_plan` (free|paid) e
-- `is_admin` (bool). Na prática o produto é uma ESCADA — curador ⊃ assinante ⊃ leitor —
-- e dois campos ortogonais pra modelar uma escada é o que produz estados sem sentido
-- (ex.: is_admin=false + user_plan=paid + poder de escrita? free + admin?).
--
--   Curador   — o dono/operador. Tudo: cria, edita, apaga, config global, IA de curadoria.
--   Assinante — paga por mês. IA de consumo inclusa + ATUALIZA obras (sem escolher
--               capa/sinopse/conflito: vale o merge automático). Não cria, não edita,
--               não apaga.
--   Leitor    — grátis. Lê o catálogo inteiro. Nenhuma escrita, nenhum LLM
--               (a IA de consumo por CRÉDITO vem numa migration posterior, junto do
--               débito — sem débito, "tem crédito" viraria LLM infinito de graça).
--
-- ADITIVA E REVERSÍVEL: `user_plan` e `is_admin` continuam existindo e populados. O
-- código lê `role` quando a coluna existe e cai no critério legado quando não existe,
-- então ele funciona IDÊNTICO antes e depois desta migration. Só remova as colunas
-- antigas quando não sobrar nenhum leitor delas.

alter table user_settings
  add column if not exists role text not null default 'leitor';

-- CHECK separado do ADD (idempotente: rodar de novo não estoura)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_settings_role_check'
  ) then
    alter table user_settings
      add constraint user_settings_role_check
      check (role in ('curador', 'assinante', 'leitor'));
  end if;
end $$;

-- Backfill a partir do estado atual. Preserva exatamente quem podia o quê:
--   is_admin = true            → curador  (o dono)
--   user_plan = 'paid'         → assinante
--   resto                      → leitor
update user_settings set role = 'curador'   where is_admin is true;
update user_settings set role = 'assinante' where is_admin is not true and user_plan = 'paid';
update user_settings set role = 'leitor'    where is_admin is not true and user_plan is distinct from 'paid';

comment on column user_settings.role is
  'Papel do usuário: curador (tudo) > assinante (IA + atualizar obra) > leitor (só leitura). Escada, não flags ortogonais. Fonte de verdade do acesso; user_plan/is_admin são legado mantido em sincronia.';

-- Signup novo cai no default 'leitor' (o trigger handle_new_user da mig 137 não
-- precisa mudar: ele insere a linha e o default cobre o papel).
