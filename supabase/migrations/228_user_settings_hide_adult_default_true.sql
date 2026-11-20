-- 228 — conta NOVA começa ocultando conteúdo adulto.
--
-- POR QUE (decisão da Ana, 2026-11-19): ver conteúdo adulto passa a exigir um gesto da pessoa —
-- escolher "Mostrar tudo" nas boas-vindas e confirmar que tem 18 anos. Com o padrão `false`, quem
-- pulava as boas-vindas (ou nunca passava por elas) ficava vendo conteúdo adulto sem escolher nem
-- confirmar nada.
--
-- Só o DEFAULT muda: nenhuma conta existente é tocada (sem UPDATE). Quem cria a linha é
-- `handle_new_user` (migration 173), que não informa a coluna e por isso herda o default.
--
-- ORDEM DE DEPLOY: 228 → código. As boas-vindas novas marcam de partida o valor que a conta tem;
-- com o código no ar antes da migration, uma conta nova chegaria com `false` e veria "Mostrar tudo"
-- já marcado.
--
-- Desfazer: ALTER TABLE public.user_settings ALTER COLUMN hide_adult_content SET DEFAULT false;

ALTER TABLE public.user_settings
  ALTER COLUMN hide_adult_content SET DEFAULT true;
