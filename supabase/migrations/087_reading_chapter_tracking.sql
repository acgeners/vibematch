-- ============================================================
-- 087 - Reading chapter tracking
-- ============================================================
-- (1) Cacheia metadados da checagem de capítulos (página /leitura) pra exibir
--     já no load, sem refazer a busca externa.
-- (2) Garante a invariante chapters_read <= total_chapters em todo o DB:
--     não dá pra ter lido um capítulo que não foi lançado, então o "lido" é
--     piso do "lançado". Em vez de bloquear, eleva total_chapters.
-- ============================================================

-- 1) Colunas de cache (datas aproximadas vindas das fontes externas)
ALTER TABLE works
  ADD COLUMN IF NOT EXISTS last_chapter_released_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_chapter_predicted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS chapters_checked_at       TIMESTAMPTZ;

-- 2) Backfill: corrige as linhas onde lido > lançado (ex.: 54 lido / 53 total).
UPDATE works
SET total_chapters = chapters_read
WHERE chapters_read IS NOT NULL
  AND (total_chapters IS NULL OR total_chapters < chapters_read);

-- 3) Mantém a invariante daqui pra frente. Eleva total_chapters pro valor lido
--    sempre que um write deixaria chapters_read > total_chapters (qualquer
--    caminho: form, import, ai_accepted, etc.).
CREATE OR REPLACE FUNCTION enforce_total_chapters_gte_read()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.chapters_read IS NOT NULL
     AND NEW.chapters_read > COALESCE(NEW.total_chapters, 0)
  THEN
    NEW.total_chapters := NEW.chapters_read;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_total_chapters_gte_read ON works;
CREATE TRIGGER trg_enforce_total_chapters_gte_read
  BEFORE INSERT OR UPDATE OF chapters_read, total_chapters ON works
  FOR EACH ROW
  EXECUTE FUNCTION enforce_total_chapters_gte_read();
