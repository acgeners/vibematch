-- Item C, Passe 2 — digest ESTRUTURADO das reviews (Sonnet 4.6), consumido pelo
-- consultor LLM (ranking / IA Rk / Deep Dive / Chat). NÃO substitui
-- `review_summary` (migration 081): aquele é o texto Haiku mostrado na UI/badge;
-- este é o sinal estruturado, preference-agnostic, pro consultor.
--
-- Forma do jsonb (preference-agnostic — o casamento com as preferências do user
-- fica a jusante, no consultor — Item B v4):
--   {
--     "consensus": "1-3 frases do que os reviews concordam",
--     "divergence": "onde as opiniões se dividem",
--     "salient_traits": [ { "trait": "...", "polarity": "positive|negative|mixed",
--                           "axis": "moralidade|tom|ritmo|arte|romance|personagens|..." } ],
--     "content_warnings": ["..."],
--     "execution": "qualidade de execução (arte, ritmo, escrita)"
--   }
ALTER TABLE works ADD COLUMN review_digest JSONB;
ALTER TABLE works ADD COLUMN review_digest_at TIMESTAMPTZ;
-- Contagem de reviews no último digest — alimenta o gate de materialidade
-- (re-roda só com crescimento material), espelhando o pack hash:n do Passe 1.
ALTER TABLE works ADD COLUMN review_digest_n INTEGER;
-- Versão do prompt/modelo do digest — força regeneração quando o summarizer muda.
ALTER TABLE works ADD COLUMN review_digest_version TEXT;
