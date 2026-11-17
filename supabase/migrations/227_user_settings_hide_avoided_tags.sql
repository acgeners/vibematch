-- 227 — a preferência "esconder as obras com tags que evito", por pessoa.
--
-- POR QUE (decisão da Ana, 2026-11-17): o filtro "Esconder tags evitadas" do /ranking e do
-- /favorites só valia enquanto o parâmetro estava na URL. Quem vetava isekai nas boas-vindas via o
-- isekai voltar ao topo na visita seguinte, porque o Alinhamento rebaixa pouco o que a pessoa evita.
-- Agora a pessoa ESCOLHE (nas boas-vindas e em Preferências); nada liga sozinho.
--
-- Leitura: `getHideAvoidedTags()` (`server/queries/current-user.ts`). O parâmetro da URL continua
-- mandando quando existe; `hide_avoided=off` desliga numa visita (`lib/tags/hide-avoided.ts`).
--
-- Nasce `false` para todo mundo: nenhuma conta muda de comportamento com a migration.
-- ORDEM DE DEPLOY: 227 → código. O código lê com `select("*")` e trata a coluna ausente como
-- `false`; só gravar a preferência falha antes da migration.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS hide_avoided_tags BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_settings.hide_avoided_tags IS
  'Esconde do /ranking, do /favorites e do "Pra você hoje" as obras com tags que a pessoa evita, quando a URL não diz nada (hide_avoided=off desliga numa visita). Escolha explícita: boas-vindas ou Preferências.';
