-- ============================================================
-- 088 — security_invoker na view latest_ai_evaluation_per_work
-- ============================================================
-- O Security Advisor do Supabase marca a view (definida em 035) com o aviso
-- `security_definer_view`: por padrão uma view roda com os privilégios do dono
-- (postgres), fazendo bypass da RLS da tabela `ai_evaluations` que está por
-- baixo. Isso a deixa "mais aberta" que as tabelas, que têm RLS habilitada e
-- sem policy (anon bloqueado — ver 013).
--
-- Setar security_invoker = on faz a view executar com os privilégios de quem
-- consulta, respeitando a RLS da tabela base. Como todo acesso do app é via
-- service role (createAdminClient), que ignora RLS, o comportamento da app
-- não muda — só fecha o buraco pra anon/authenticated, igual às tabelas.
-- ============================================================

ALTER VIEW latest_ai_evaluation_per_work SET (security_invoker = on);
