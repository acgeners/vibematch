-- ============================================================
-- 174 — `tags.adult_score_tier`: piso/teto de `adult_content` vira DADO, não código
-- ============================================================
-- Até aqui, o piso/teto da NOTA `adult_content` vinha de três Sets hardcoded em
-- lib/ai-evaluation/adult-content-rules.ts (EXPLICIT_ACT_TAGS/EXPLICIT_LABEL_TAGS/
-- ADULT_LABEL_TAGS), enquanto o FLAG `works.is_adult` (migração 161) já lê
-- `tags.adult_indicator[_strong]` do banco. As duas fontes divergiram: tags novas
-- classificadas pelo enricher de IA (lib/tags/ingest.ts) ou por `setTagAdult` viram
-- `adult_indicator_strong=true` (afetam is_adult) mas NUNCA entram na lista hardcoded
-- (não afetam o piso da nota) — vazamento estrutural, não pontual.
--
-- Esta migração só MOVE a fonte de verdade das 53 tags já cobertas hoje (46
-- 'explicit' + 7 'label') pro banco — ZERO mudança de comportamento. Os nomes batem
-- 1:1 com os Sets do rules.ts no momento desta migração (2026-07-31).
--
-- As demais tags hoje `adult_indicator_strong=true` (ex.: BDSM, Big Breasts,
-- Pedophilia, Necrophilia — algumas excluídas de PROPÓSITO pelo rules.ts como aviso/
-- dinâmica, outras nunca avaliadas) ficam `adult_score_tier IS NULL` (= sem piso,
-- igual hoje). Não é backfill às cegas: cada uma passa por revisão humana (fila
-- nova em /settings, ver lib/tags/adult-classify.ts e server/actions/tag-review.ts).
-- ============================================================

BEGIN;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS adult_score_tier TEXT
    CHECK (adult_score_tier IN ('label', 'explicit'));
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS adult_score_tier_reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN tags.adult_score_tier IS
  'Piso garantido de category_scores.adult_content quando a tag está presente: '
  '''explicit'' = piso 9 (ato/rótulo que AFIRMA cena sexual mostrada); '
  '''label'' = piso 7 (rótulo de faixa adulta, sem afirmar cena); '
  'NULL = nenhum piso (aviso/dinâmica/atributo — ex. BDSM, Big Breasts — ou tag ainda '
  'não revisada). Independente de adult_indicator/_strong, que decidem works.is_adult.';
COMMENT ON COLUMN tags.adult_score_tier_reviewed_at IS
  'Quando a tag passou pela revisão do eixo adult_score_tier (humana ou pelo '
  'enricher de IA na criação). NULL = nunca revisada — distingue "revisada, sem '
  'piso" (tier NULL + reviewed_at setado) de "backlog, nunca avaliada" (as duas '
  'NULL) — sem isto a fila de revisão nunca esvaziaria.';

-- 'explicit' — EXPLICIT_ACT_TAGS (41) + EXPLICIT_LABEL_TAGS (3) do rules.ts.
UPDATE tags SET adult_score_tier = 'explicit'
WHERE tag_group_id = '90edf1bb-a80e-459e-b421-ebca4e493128'  -- content_indicator
  AND name IN (
    'Ahegao','Anal Sex','Ashikoki','Bukkake','Cervix Penetration','Clothed Intercourse',
    'Cowgirl Position','Cunnilingus','Doggy Style','Double/Multiple Penetration',
    'Drunken Intercourse','Ejaculation','Enemies Have Sex','Facial','Fingering',
    'First-Time Intercourse','Footjob','Gangbang','Handjob','Intercrural Intercourse',
    'Masturbation','Mirror Sex','Missionary Position','Office Intercourse','Oral Sex',
    'Orgasms','Outdoor Intercourse','Pegging','Phone Sex','Pregnancy Sex','Prison Sex',
    'Public Sex','Rough Sex','School Intercourse','Sex Magic','Sex Toy/s','Sitting Sex',
    'Squirting','Strap-On','Sumata','Threesome','Toilet Intercourse','Urethral Insertion',
    'Smut','Hentai','Pornographic'
  );

-- 'label' — ADULT_LABEL_TAGS (7) do rules.ts.
UPDATE tags SET adult_score_tier = 'label'
WHERE tag_group_id = '90edf1bb-a80e-459e-b421-ebca4e493128'  -- content_indicator
  AND name IN ('Adult', 'Sexual Content', 'Borderline H', 'Hypersexuality', 'R19', 'R19 Version', 'Erotica');

-- As 53 tags acima já foram avaliadas neste eixo (é o que esta migração faz).
UPDATE tags SET adult_score_tier_reviewed_at = now()
WHERE adult_score_tier IN ('explicit', 'label') AND adult_score_tier_reviewed_at IS NULL;

-- Guarda: se algum nome não casou (tag renomeada/removida desde a escrita desta
-- migração), FALHA em vez de aplicar cobertura torta em silêncio — mesmo padrão
-- de guarda da migração 161.
DO $$
DECLARE n_explicit int; n_label int;
BEGIN
  SELECT count(*) INTO n_explicit FROM tags WHERE adult_score_tier = 'explicit';
  SELECT count(*) INTO n_label FROM tags WHERE adult_score_tier = 'label';
  IF n_explicit <> 46 THEN
    RAISE EXCEPTION 'esperava 46 tags adult_score_tier=explicit, casaram %; abortando', n_explicit;
  END IF;
  IF n_label <> 7 THEN
    RAISE EXCEPTION 'esperava 7 tags adult_score_tier=label, casaram %; abortando', n_label;
  END IF;
END $$;

COMMIT;
