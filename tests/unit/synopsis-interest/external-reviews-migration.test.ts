import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

const MIGRATIONS_DIR = "supabase/migrations"
const MIGRATION = readFileSync(`${MIGRATIONS_DIR}/112_work_external_reviews_manual.sql`, "utf8")
const CORPUS = readFileSync("lib/synopsis-interest/canonical-review-corpus.ts", "utf8")

/** DDL sem comentários (`-- …` + `COMMENT ON … ;`) — asserções de AUSÊNCIA olham só o DDL. */
const DDL = MIGRATION.replace(/--.*$/gm, "").replace(/COMMENT ON[\s\S]*?;/gi, "")

describe("migration 112 — canônica estrita (B2.2L)", () => {
  it("1+4. NÃO contém IF NOT EXISTS nem DROP no DDL (falha em drift; trigger não é removido)", () => {
    expect(DDL).not.toMatch(/IF NOT EXISTS/i)
    expect(DDL).not.toMatch(/\bDROP\b/i)
  })
  it("3. todos os objetos qualificados com public. (sem depender de search_path)", () => {
    expect(MIGRATION).toMatch(/CREATE TABLE public\.work_external_reviews_manual/)
    expect(MIGRATION).toMatch(/REFERENCES public\.works\(id\) ON DELETE CASCADE/)
    expect(MIGRATION).toMatch(/CREATE UNIQUE INDEX \w+\s+ON public\.work_external_reviews_manual/)
    expect(MIGRATION).toMatch(/CREATE INDEX \w+\s+ON public\.work_external_reviews_manual/)
    expect(MIGRATION).toMatch(/CREATE TRIGGER[\s\S]*ON public\.work_external_reviews_manual/)
    expect(MIGRATION).toMatch(/EXECUTE FUNCTION public\.update_updated_at\(\)/)
    expect(MIGRATION).toMatch(/ALTER TABLE public\.work_external_reviews_manual ENABLE ROW LEVEL SECURITY/)
    expect(MIGRATION).toMatch(/COMMENT ON TABLE public\.work_external_reviews_manual/)
    // nenhuma referência DDL NÃO qualificada
    expect(MIGRATION).not.toMatch(/REFERENCES works\(/)
    expect(MIGRATION).not.toMatch(/CREATE TABLE work_external_reviews_manual\b/)
    expect(MIGRATION).not.toMatch(/ALTER TABLE work_external_reviews_manual\b/)
    expect(MIGRATION).not.toMatch(/\bON work_external_reviews_manual\b/)
    expect(MIGRATION).not.toMatch(/EXECUTE FUNCTION update_updated_at\(/)
  })
  it("6. campos opcionais NÃO aceitam string vazia (CHECKs *_nonblank)", () => {
    expect(DDL).toMatch(/source_url IS NULL OR NULLIF\(BTRIM\(source_url\),\s*''\) IS NOT NULL/i)
    expect(DDL).toMatch(/external_review_id IS NULL OR NULLIF\(BTRIM\(external_review_id\),\s*''\) IS NOT NULL/i)
    expect(DDL).toMatch(/reviewer_name IS NULL OR NULLIF\(BTRIM\(reviewer_name\),\s*''\) IS NOT NULL/i)
    expect(DDL).toMatch(/language IS NULL[\s\S]*NULLIF\(BTRIM\(language\),\s*''\) IS NOT NULL[\s\S]*language ~/i)
  })
  it("7. proveniência obrigatória (NULLIF/BTRIM) + hash 64-hex + text não-vazio", () => {
    expect(DDL).toMatch(/NULLIF\(BTRIM\(source_url\),\s*''\) IS NOT NULL\s*OR\s*NULLIF\(BTRIM\(external_review_id\),\s*''\) IS NOT NULL/i)
    expect(DDL).toMatch(/normalized_text_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(DDL).toMatch(/NULLIF\(BTRIM\(text\),\s*''\) IS NOT NULL/i)
  })
  it("8+9. RLS habilitada, ZERO policies", () => {
    expect(DDL).toMatch(/ENABLE ROW LEVEL SECURITY/i)
    expect(DDL).not.toMatch(/CREATE POLICY/i)
  })
  it("10. zero DML / backfill / seed", () => {
    expect(DDL).not.toMatch(/INSERT\s+INTO/i)
    expect(DDL).not.toMatch(/UPDATE\s+\w+\s+SET/i)
    expect(DDL).not.toMatch(/DELETE\s+FROM/i)
    expect(DDL).not.toMatch(/backfill|seed/i)
  })
  it("11. NÃO referencia work_manual_reviews (DDL)", () => {
    expect(DDL).not.toMatch(/work_manual_reviews/)
  })
  it("dedup: UNIQUE parcial (work_id,source,external_review_id) WHERE NOT NULL + (work_id,source,hash); sem cross-source", () => {
    expect(DDL).toMatch(/CREATE UNIQUE INDEX[^;]*\(work_id,\s*source,\s*external_review_id\)[^;]*WHERE external_review_id IS NOT NULL/i)
    expect(DDL).toMatch(/CREATE UNIQUE INDEX[^;]*\(work_id,\s*source,\s*normalized_text_hash\)/i)
    expect(DDL).not.toMatch(/UNIQUE INDEX[^;]*\(work_id,\s*normalized_text_hash\)/i)
  })
  it("created_by NULLABLE; colunas pessoais ausentes; convenções", () => {
    expect(DDL).not.toMatch(/created_by\s+TEXT\s+NOT NULL/i)
    expect(DDL).not.toMatch(/created_by[^,]*DEFAULT/i)
    expect(DDL).not.toMatch(/user_rating|personal_status|interest_label|reading_status|prediction|\bnote\b|internal_note/i)
    expect(DDL).toMatch(/gen_random_uuid\(\)/)
    expect(DDL).toMatch(/source ~ '\^\[a-z0-9\]/)
  })
})

describe("migration 112 — numeração/ordenação", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
  it("número 112 não conflita (único 112_*)", () => {
    expect(files.filter((f) => /^112_/.test(f))).toHaveLength(1)
  })
  it("public.update_updated_at() é definida em migration ANTERIOR à 112", () => {
    const defines = files
      .filter((f) => /FUNCTION update_updated_at/.test(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8")))
      .map((f) => parseInt(f.slice(0, 3), 10))
      .filter((n) => !Number.isNaN(n))
    expect(Math.min(...defines)).toBeLessThan(112)
  })
})

describe("guard arquitetural — corpus canônico não importa o store pessoal", () => {
  it("canonical-review-corpus NÃO importa/referencia work_manual_reviews nem o fluxo pessoal", () => {
    expect(CORPUS).not.toMatch(/work_manual_reviews/)
    expect(CORPUS).not.toMatch(/manual-reviews-section|manual-reviews-card|review-drafts-field|saveManualReviews|getManualReviews|readAllManualReviews/)
  })
})
