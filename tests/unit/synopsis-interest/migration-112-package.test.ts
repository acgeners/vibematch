import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const MIG = "supabase/migrations/112_work_external_reviews_manual.sql"
const APPLY = "docs/sql/112_work_external_reviews_manual_apply.sql"
const PRECHECK = "docs/sql/112_work_external_reviews_manual_precheck.sql"
const POSTCHECK = "docs/sql/112_work_external_reviews_manual_postcheck.sql"
const MANIFEST = "docs/sql/112_work_external_reviews_manual_package-manifest.json"

const read = (p: string) => readFileSync(p, "utf8")
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex")
const ddl = (s: string) => s.replace(/--.*$/gm, "").replace(/COMMENT ON[\s\S]*?;/gi, "")
/** Núcleo estrutural: SÓ remove comentários + BEGIN/COMMIT + espaços (nenhuma lista de transformações). */
const core = (s: string) =>
  s.replace(/--.*$/gm, "").replace(/^\s*(BEGIN|COMMIT)\s*;?\s*$/gim, "").replace(/\s+/g, " ").trim()

const WRITE = /\b(INSERT\s+INTO|UPDATE\s+[\w.]+\s+SET|DELETE\s+FROM|TRUNCATE|CREATE\s+(TABLE|INDEX|UNIQUE|TRIGGER|FUNCTION|VIEW|TYPE)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX|TRIGGER|FUNCTION|VIEW|TYPE))\b/i

describe("migration 112 — pacote de aplicação (B2.2L)", () => {
  it("5. apply tem o MESMO DDL funcional da migration (só BEGIN/COMMIT + comentários externos)", () => {
    expect(core(read(APPLY))).toBe(core(read(MIG)))
    expect(read(APPLY)).toMatch(/^BEGIN;/m)
    expect(read(APPLY)).toMatch(/^COMMIT;/m)
  })
  it("apply NÃO contém IF NOT EXISTS nem DROP (não há mais lista de transformações)", () => {
    expect(ddl(read(APPLY))).not.toMatch(/IF NOT EXISTS/i)
    expect(ddl(read(APPLY))).not.toMatch(/\bDROP\b/i)
  })
  it("12. precheck e postcheck são read-only (sem DML/DDL)", () => {
    expect(ddl(read(PRECHECK))).not.toMatch(WRITE)
    expect(ddl(read(POSTCHECK))).not.toMatch(WRITE)
  })
  it("14. scripts NÃO escrevem no histórico de migrations nem invocam CLI de migration", () => {
    for (const f of [PRECHECK, POSTCHECK, APPLY]) {
      expect(read(f)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b[\s\S]{0,80}schema_migrations/i)
      expect(read(f)).not.toMatch(/supabase\s+(migration|db\s+push|link|repair)/i)
    }
  })
  it("postcheck verifica public, sem homônimo, opcionais não-vazios, trigger, RLS, policies=0, linhas=0", () => {
    const p = read(POSTCHECK)
    expect(p).toMatch(/no_homonym_other_schema/)
    expect(p).toMatch(/relrowsecurity/)
    expect(p).toMatch(/pg_policies/)
    expect(p).toMatch(/count\(\*\)[\s\S]*work_external_reviews_manual/)
    expect(p).toMatch(/pg_get_triggerdef/)
    expect(p).toMatch(/pg_get_constraintdef/)
    expect(p).toMatch(/pg_indexes|indexdef/)
    expect(p).toMatch(/regnamespace|nspname|schema_name/)
  })
  it("precheck verifica ausência de tabela/índices/trigger + works/uuid/fn + registro remoto", () => {
    const p = read(PRECHECK)
    expect(p).toMatch(/table_absent/)
    expect(p).toMatch(/indexes_absent/)
    expect(p).toMatch(/trigger_absent/)
    expect(p).toMatch(/works_id_uuid/)
    expect(p).toMatch(/fn_update_updated_at/)
    expect(p).toMatch(/schema_migrations/) // leitura informativa do histórico (SELECT)
  })
  it("11. manifesto referencia o SHA correto da migration (novo) + applied=false", () => {
    const m = JSON.parse(read(MANIFEST))
    expect(m.migrationSha256).toBe(sha(MIG))
    expect(m.applicationScriptSha256).toBe(sha(APPLY))
    expect(m.precheckSha256).toBe(sha(PRECHECK))
    expect(m.postcheckSha256).toBe(sha(POSTCHECK))
    expect(m.applied).toBe(false)
    expect(m.rlsExpected).toBe(true)
    expect(m.expectedPolicyCount).toBe(0)
    expect(m.expectedRowCount).toBe(0)
  })
  it("13. pacote ANTERIOR marcado como SUPERSEDED (hashes antigos preservados)", () => {
    const m = JSON.parse(read(MANIFEST))
    expect(m.superseded.note).toMatch(/SUPERSEDED/i)
    expect(m.superseded.previousMigrationSha256).toBe("591a6cfe36ead2749be1cf8062cf3dd9f914c88aeb8f2a88aa6b401e8b2c70b0")
    expect(m.superseded.previousMigrationApplicationPackageSignature).toBe("60b60c20ffd618ed6c3c6bbb1964d7195d7fe6ca061f004b2b1ed8a02744ad43")
    // assinatura nova difere da anterior
    expect(m.migrationApplicationPackageSignature).not.toBe(m.superseded.previousMigrationApplicationPackageSignature)
  })
  it("12b. nenhum arquivo do pacote referencia work_manual_reviews (DDL real)", () => {
    for (const f of [MIG, APPLY, PRECHECK, POSTCHECK]) expect(ddl(read(f))).not.toMatch(/work_manual_reviews/)
    expect(read(MANIFEST)).not.toMatch(/work_manual_reviews/)
  })
  it("15. nenhum arquivo contém secret / service-role key", () => {
    const SECRET = /eyJ[A-Za-z0-9._-]{20,}|sb_[a-z]+_[A-Za-z0-9]{20,}|service[_-]?role[_-]?key\s*[:=]|postgres(ql)?:\/\/[^:\s]+:[^@\s]+@|(password|secret|api[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i
    for (const f of [MIG, APPLY, PRECHECK, POSTCHECK, MANIFEST]) expect(read(f)).not.toMatch(SECRET)
  })
})
