-- 139_user_settings_is_admin.sql
-- Fase 3 (papéis) da fundação multi-user (PLANO-MULTIUSER.md).
--
-- Troca o admin CODE-BASED (dono = deslogado / linha singleton) por uma FLAG
-- persistida em user_settings. A flag SOBREVIVE ao claim da conta do dono
-- (Fase 2): quando o dono reivindicar sua linha e passar a logar como si mesmo,
-- ele segue admin porque a linha carrega is_admin=true — não depende mais de
-- estar deslogado.
--
-- ADITIVO e retrocompatível: `isCurrentUserAdmin()` continua tratando "sem
-- sessão" como admin (dono deslogado) e cai no critério legado (=== singleton)
-- quando a coluna/linha não resolve — então o app funciona IGUAL antes e depois
-- de aplicar esta migration.
--
-- Aplicar à mão no SQL editor do Supabase (CLI dessincronizado — ver
-- memória project_migration_apply_mechanism).

-- 1) Flag de admin/operador do catálogo. Default false: todo signup nasce
--    não-admin (read-only sobre o catálogo compartilhado).
alter table public.user_settings
  add column if not exists is_admin boolean not null default false;

-- 2) Marca a(s) linha(s) legada(s) do DONO (sem auth_user_id = pré-auth /
--    singleton) como admin. Signups (auth_user_id preenchido) ficam false.
update public.user_settings
  set is_admin = true
  where auth_user_id is null;
