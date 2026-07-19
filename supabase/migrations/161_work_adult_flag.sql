-- ============================================================
-- 161 — Classificação 18+ robusta e GRADUADA: is_adult = override ?? auto
-- ============================================================
-- Nem a nota da IA nem as tags inferidas foram validadas → nenhuma decide sozinha,
-- EXCETO tags sexualmente explícitas (cuja especificidade já é garantia: "Bukkake"
-- não é falso-positivo). Sinal fraco precisa de corroboração; o que sobra vai pra
-- revisão humana (o override vira verdade permanente).
--
--   tags.adult_indicator        → as 59 tags do content_indicator que indicam
--                                 conteúdo sexual (lista curada pelo dono).
--   tags.adult_indicator_strong → subconjunto EXPLÍCITO (ato/anatomia) — decide
--                                 sozinho. As 6 SOFT (Adult, Sexual Content,
--                                 Sexually Active Protagonist, Sexual Fantasies,
--                                 Borderline H, Vanilla) ficam FALSE: genéricas.
--   works.adult_auto  → true se: (>=1 tag STRONG) OU (>=1 tag SOFT E nota>=7).
--                       MONOTÔNICO na app: só o override humano desmarca.
--   works.adult_reason→ proveniência ('tag_explicit' | 'tag_soft_score' |
--                       'ai_review' | 'manual'): pra auditoria e transparência.
--   works.adult_override → decisão HUMANA (true/false/null=segue auto). VENCE.
--   works.is_adult    → COALESCE(override, auto). Único campo que a UI/filtro leem.
--
-- Sinal FRACO não coberto pelo auto (tag soft sem nota; nota>=7 sem tag; nada) fica
-- adult_auto=false e entra na FILA DE AUDITORIA (2ª opinião de modelo forte + humano).
-- ============================================================

-- 1) Flags nas tags: adult_indicator (as 59) + adult_indicator_strong (as explícitas).
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS adult_indicator BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS adult_indicator_strong BOOLEAN NOT NULL DEFAULT false;

UPDATE tags SET adult_indicator = true
WHERE tag_group_id = '90edf1bb-a80e-459e-b421-ebca4e493128'  -- content_indicator
  AND name IN (
    'Adult','Ahegao','Anal Sex','Ashikoki','BDSM','Big Areolae','Big Breasts',
    'Big Penis','Borderline H','Breast Sucking','Bukkake','Cervix Penetration',
    'Clothed Intercourse','Cowgirl Position','Cunnilingus','Doggy Style',
    'Double/Multiple Penetration','Ejaculation','Enemies Have Sex','Fingering',
    'Footjob','Futanari','Gagged','Gangbang','Handjob','Hypersexuality',
    'Intercrural Intercourse','Masturbation','Mirror Sex','Missionary Position',
    'Necrophilia','Netorare','Oral Sex','Orgasms','Outdoor Intercourse',
    'Pedophilia','Pegging','Pregnancy Sex','Prison Sex','Prostitution',
    'Public Sex','R19','R19 Version','Rough Sex','School Intercourse',
    'Sexual Content','Sexual Fantasies','Sexually Active Protagonist',
    'Sitting Sex','Squirting','Sumata','Tentacles','Threesome',
    'Toilet Intercourse','Urethral Insertion','Vanilla','Voyeurism','Wax Play',
    'Whipping'
  );

-- STRONG = todas as adult_indicator EXCETO as 6 genéricas.
UPDATE tags SET adult_indicator_strong = true
WHERE adult_indicator
  AND name NOT IN (
    'Adult','Sexual Content','Sexually Active Protagonist','Sexual Fantasies',
    'Borderline H','Vanilla'
  );

-- Guarda: se algum nome não casou (tag renomeada/removida), FALHA a transação
-- inteira em vez de aplicar classificação torta em silêncio.
DO $$
DECLARE n_ind int; n_strong int;
BEGIN
  SELECT count(*) INTO n_ind FROM tags WHERE adult_indicator;
  SELECT count(*) INTO n_strong FROM tags WHERE adult_indicator_strong;
  IF n_ind <> 59 THEN
    RAISE EXCEPTION 'esperava 59 tags adult_indicator, casaram %; abortando', n_ind;
  END IF;
  IF n_strong <> 53 THEN
    RAISE EXCEPTION 'esperava 53 tags STRONG (59 - 6 soft), casaram %; abortando', n_strong;
  END IF;
END $$;

COMMENT ON COLUMN tags.adult_indicator IS
  'Tag do content_indicator que indica conteúdo sexual (lista curada). Alimenta works.adult_auto.';
COMMENT ON COLUMN tags.adult_indicator_strong IS
  'Subconjunto sexualmente EXPLÍCITO (ato/anatomia) — decide 18+ sozinho. False = tag genérica (precisa corroboração).';

-- 2) Colunas de classificação na obra + is_adult gerado.
ALTER TABLE works ADD COLUMN IF NOT EXISTS adult_override BOOLEAN;            -- null = segue o auto
ALTER TABLE works ADD COLUMN IF NOT EXISTS adult_auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE works ADD COLUMN IF NOT EXISTS adult_reason TEXT;                 -- proveniência do auto
ALTER TABLE works ADD COLUMN IF NOT EXISTS is_adult BOOLEAN
  GENERATED ALWAYS AS (COALESCE(adult_override, adult_auto)) STORED;

COMMENT ON COLUMN works.adult_override IS
  'Decisão humana de 18+: true força, false força limpo, null segue o auto. Vence o auto.';
COMMENT ON COLUMN works.adult_auto IS
  'true se >=1 tag STRONG, ou (>=1 tag SOFT E nota>=7), ou 2ª opinião IA. Monotônico: só o override desmarca.';
COMMENT ON COLUMN works.adult_reason IS
  'Proveniência do adult_auto: tag_explicit | tag_soft_score | ai_review | manual.';
COMMENT ON COLUMN works.is_adult IS
  'Efetivo: COALESCE(adult_override, adult_auto). Único campo que a UI/filtro devem ler.';

-- 3) Backfill graduado.
-- 3a) tag STRONG (explícita) → decide sozinha.
UPDATE works w SET adult_auto = true, adult_reason = 'tag_explicit'
WHERE EXISTS (
  SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
  WHERE wt.work_id = w.id AND t.adult_indicator_strong
);

-- 3b) tag SOFT (genérica) + nota>=7 corroborando → flag. (Só as ainda não flagadas.)
UPDATE works w SET adult_auto = true, adult_reason = 'tag_soft_score'
WHERE adult_auto = false
  AND EXISTS (
    SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
    WHERE wt.work_id = w.id AND t.adult_indicator AND NOT t.adult_indicator_strong
  )
  AND EXISTS (
    SELECT 1 FROM category_scores cs
    WHERE cs.work_id = w.id AND cs.criterion_slug = 'adult_content' AND cs.score >= 7
  );

-- 4) Índice p/ o filtro de listas (Fase 2).
CREATE INDEX IF NOT EXISTS works_is_adult_idx ON works (is_adult) WHERE is_adult;
