-- ============================================================
-- 111 — synopsis_quality_predictions.input_signature  [Potencial de Interesse, passo 4]
-- ============================================================
-- ADITIVA e NÃO-DESTRUTIVA. Fecha o gap de invalidação: hoje a freshness da
-- previsão depende SÓ de taste_profile_hash (+ flag stale) — mudança de TÍTULO
-- ou de TAGS NÃO invalida a previsão. `input_signature` é a assinatura canônica
-- de TODAS as entradas do prompt (perfil + título + sinopse + fonte canonical/raw
-- + tags ordenadas + modelo + prompt_version + schema_version).
--
-- COMPATIBILIDADE (dual-read/dual-write, sem invalidar o catálogo pago):
--   - coluna NULLABLE; linhas LEGADAS ficam NULL.
--   - leitura: linha com input_signature compara a assinatura; linha NULL cai na
--     regra antiga (flag stale + taste_profile_hash) — ver classifyInterestReadiness.
--   - escrita: previsões NOVAS gravam input_signature; legadas migram quando
--     forem naturalmente reprocessadas. O app já tolera a coluna ausente (probe
--     em lib/orchestration/integrations/synopsis-interest.ts → modo legado).
--
-- NÃO inclui review_digest (vem depois, no Plano 3). Sem índice novo: os lookups
-- são por (work_id, prompt_version), já cobertos pelo UNIQUE existente.
-- RLS já ligado em synopsis_quality_predictions — a coluna herda.
-- ============================================================

alter table synopsis_quality_predictions
  add column if not exists input_signature text;

comment on column synopsis_quality_predictions.input_signature is
  'Assinatura canônica das entradas do prompt do Potencial de Interesse (perfil+título+sinopse+fonte+tags ordenadas+modelo+prompt+schema). NULL = linha legada (dual-read cai na regra flag+hash). Fecha o gap de invalidação por título/tags. NÃO inclui review_digest (Plano 3).';
