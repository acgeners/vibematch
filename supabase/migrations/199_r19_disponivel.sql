-- ============================================================
-- 199 — "R19 disponível": obra com edição R15 E R19 não é ocultada
-- ============================================================
-- Decisão da curadora (2026-09-26): uma obra publicada em DUAS edições (R15 e R19)
-- tem de aparecer nos DOIS filtros:
--   · "ocultar conteúdo 18+" → NÃO some (existe uma edição que a pessoa pode ler);
--   · "só 18+"               → aparece (existe uma edição R19).
--
-- Até aqui o fato "existe uma edição R19" chegava de três jeitos, nenhum filtrável:
--   · marcador "[R19 disponível]" reinjetado na sinopse (lib/synopsis-text.ts) — só texto;
--   · tag "Uncensored Version Available"
--   · tag "Official English R19 Version Available" (esta ainda contava como sinal
--     SOFT de 18+, o que contradizia a regra de edição da migration 164).
--
-- O que muda:
--   1. UMA tag canônica, "R19 disponível" (a antiga "Uncensored Version Available",
--      renomeada — mantém o id e com ele as preferências já declaradas). A outra é
--      fundida nela, e os dois slugs antigos viram alias.
--   2. tags.marks_r19_edition → quem diz "esta tag afirma edição R19".
--   3. works.r19_edition, mantida por gatilho em work_tags.
--   4. A sinopse gravada com o marcador aplica a tag sozinha (gatilho em work_synopses),
--      então todo caminho de escrita fica coberto sem depender de lembrar no código.
--   5. is_adult = COALESCE(override, auto AND NOT r19_edition). A decisão HUMANA
--      continua vencendo; o automático deixa de ocultar obra com edição R15.
--      Os ~46 leitores de is_adult (ocultar) não mudam; quem muda é o "só 18+"
--      (server/queries/ranking.ts), que passa a ser is_adult OR r19_edition.
--
-- ⚠️ A NOTA adult_content NÃO muda: a tag não tem adult_score_tier (sem piso), e a
--    regra de edição da 164 segue valendo — a nota descreve o que as reviews relatam.
-- ⚠️ adult_auto NÃO é tocado (continua monotônico e continua dizendo "os sinais
--    apontam conteúdo adulto"); só a expressão de is_adult passa a considerar a edição.
-- ============================================================

-- 1) Flag na tag.
ALTER TABLE tags ADD COLUMN IF NOT EXISTS marks_r19_edition BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tags.marks_r19_edition IS
  'A tag afirma que a obra tem uma edição R19 além da R15 (mig 199). Mantém works.r19_edition.';

-- 2) Tag canônica: renomeia a "Uncensored Version Available" (preserva o id).
DO $$
DECLARE
  v_canon uuid;
  v_eng   uuid;
BEGIN
  SELECT id INTO v_canon FROM tags WHERE slug = 'uncensored-version-available';
  IF v_canon IS NULL THEN
    SELECT id INTO v_canon FROM tags WHERE slug = 'r19-disponivel';
  END IF;
  IF v_canon IS NULL THEN
    RAISE EXCEPTION 'mig 199: tag "Uncensored Version Available" não encontrada — não aplico às cegas';
  END IF;

  UPDATE tags
     SET name = 'R19 disponível',
         slug = 'r19-disponivel',
         marks_r19_edition = true,
         adult_indicator = false,
         adult_indicator_strong = false,
         adult_score_tier = NULL
   WHERE id = v_canon;

  -- Funde a "Official English R19 Version Available" na canônica.
  SELECT id INTO v_eng FROM tags WHERE slug = 'official-english-r19-version-available';
  IF v_eng IS NOT NULL AND v_eng <> v_canon THEN
    INSERT INTO work_tags (work_id, tag_id, source, confidence)
    SELECT work_id, v_canon, source, confidence FROM work_tags WHERE tag_id = v_eng
    ON CONFLICT (work_id, tag_id) DO NOTHING;
    -- Aliases que apontavam pra ela passam a apontar pra canônica.
    UPDATE tag_alias SET canonical_tag_id = v_canon WHERE canonical_tag_id = v_eng;
    DELETE FROM tags WHERE id = v_eng;  -- cascade: work_tags/prefs/assignments da fundida
  END IF;

  -- Slugs antigos (e o que slugifyTagName produz de "R19 disponível") → canônica.
  INSERT INTO tag_alias (alias_slug, canonical_tag_id)
  VALUES
    ('uncensored-version-available', v_canon),
    ('official-english-r19-version-available', v_canon),
    ('r19-dispon-vel', v_canon)
  ON CONFLICT (alias_slug) DO UPDATE SET canonical_tag_id = EXCLUDED.canonical_tag_id;
END $$;

-- 3) Coluna na obra + gatilho que a mantém a partir de work_tags.
ALTER TABLE works ADD COLUMN IF NOT EXISTS r19_edition BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN works.r19_edition IS
  'Existe edição R19 além da R15 (tag com marks_r19_edition). Derivada por gatilho — não gravar à mão. Mig 199.';

CREATE OR REPLACE FUNCTION public.sync_work_r19_edition(p_work_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE works w
     SET r19_edition = sub.v
    FROM (
      SELECT EXISTS (
        SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
         WHERE wt.work_id = p_work_id AND t.marks_r19_edition
      ) AS v
    ) sub
   WHERE w.id = p_work_id AND w.r19_edition IS DISTINCT FROM sub.v;
$$;

CREATE OR REPLACE FUNCTION public.trg_work_tags_r19_edition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sync_work_r19_edition(NEW.work_id);
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    IF TG_OP = 'DELETE' OR OLD.work_id IS DISTINCT FROM NEW.work_id THEN
      PERFORM public.sync_work_r19_edition(OLD.work_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_work_tags_r19_edition ON work_tags;
CREATE TRIGGER trg_work_tags_r19_edition
  AFTER INSERT OR UPDATE OR DELETE ON work_tags
  FOR EACH ROW EXECUTE FUNCTION public.trg_work_tags_r19_edition();

-- 4) Marcador na sinopse → tag. O regex é o BOILERPLATE_MARKER_RE de
--    lib/ai-evaluation/adult-content-rules.ts: "[R19 …]"/"[R18 …]" ou linha solta R18/R19.
CREATE OR REPLACE FUNCTION public.trg_work_synopses_r19_marker()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.text ~* '\[R1[89][^]]*\]' OR NEW.text ~* '(^|\n)\s*R\s*-?\s*1[89]\s*(\n|$)' THEN
    INSERT INTO work_tags (work_id, tag_id, source)
    SELECT NEW.work_id, t.id, 'synopsis_marker'
      FROM tags t WHERE t.slug = 'r19-disponivel'
    ON CONFLICT (work_id, tag_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_work_synopses_r19_marker ON work_synopses;
CREATE TRIGGER trg_work_synopses_r19_marker
  AFTER INSERT OR UPDATE OF text ON work_synopses
  FOR EACH ROW EXECUTE FUNCTION public.trg_work_synopses_r19_marker();

-- 5) Backfill: sinopses que já têm o marcador ganham a tag; depois, a coluna.
INSERT INTO work_tags (work_id, tag_id, source)
SELECT DISTINCT s.work_id, t.id, 'synopsis_marker'
  FROM work_synopses s
  JOIN tags t ON t.slug = 'r19-disponivel'
 WHERE s.text ~* '\[R1[89][^]]*\]' OR s.text ~* '(^|\n)\s*R\s*-?\s*1[89]\s*(\n|$)'
ON CONFLICT (work_id, tag_id) DO NOTHING;

UPDATE works w SET r19_edition = true
 WHERE EXISTS (
   SELECT 1 FROM work_tags wt JOIN tags t ON t.id = wt.tag_id
    WHERE wt.work_id = w.id AND t.marks_r19_edition
 ) AND NOT w.r19_edition;

-- 6) is_adult: a decisão humana vence; o automático não oculta obra com edição R15.
ALTER TABLE works ALTER COLUMN is_adult
  SET EXPRESSION AS (COALESCE(adult_override, adult_auto AND NOT r19_edition));

COMMENT ON COLUMN works.is_adult IS
  'COALESCE(adult_override, adult_auto AND NOT r19_edition). Governa OCULTAR conteúdo 18+. '
  'O filtro "só 18+" é is_adult OR r19_edition (obra com as duas edições aparece nos dois). Mig 199.';
