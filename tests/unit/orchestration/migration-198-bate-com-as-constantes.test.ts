import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { CRITERIA_INFO, CRITERIA_RUBRICS } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * `sync-constants` DEPOIS da 198 tem de dar DIFF ZERO.
 *
 * 🔴 Por que isto precisa de teste: `lib/constants/criteria.ts` e `types/domain.ts` são
 * GERADOS do banco, e nesta branch eles foram materializados À MÃO como o output ESPERADO
 * pós-migration — porque rodar o gerador contra a nuvem de hoje produziria o contrato ANTIGO.
 * São, portanto, duas afirmações sobre o mesmo fato: a migration e o arquivo gerado. Sem
 * amarrá-las, a 198 pode ser editada e o arquivo ficar descrevendo outra coisa, e o primeiro
 * `sync-constants` pós-cutover viraria um diff surpresa em vez de confirmação.
 *
 * ⚠️ Isto NÃO substitui rodar `npm run sync-constants` depois do cutover — ele é a prova final,
 * contra o banco de verdade. O que este teste garante é que o diff esperado é ZERO.
 */
const RAIZ = execSync("git rev-parse --show-toplevel").toString().trim()
const SQL = readFileSync(
  join(RAIZ, "supabase/migrations/198_producer_alvo_11_atributos.sql"), "utf8",
)
/** Como um literal de texto aparece no SQL depois do escaping. */
const noSql = (t: string) => SQL.includes(t.replace(/'/g, "''"))

describe("a migration 198 e as constantes geradas descrevem o MESMO producer", () => {
  it("todo slug de CRITERION_SLUGS é criado ou atualizado pela 198", () => {
    for (const slug of CRITERION_SLUGS) {
      const criado = SQL.includes(`'${slug}', '`)
      const atualizado = SQL.includes(`where slug = '${slug}' and eval_type = 'IA'`)
      expect(criado || atualizado, `${slug} não aparece na 198`).toBe(true)
    }
  })

  it.each([...CRITERION_SLUGS])("%s: nome, descrição, faixas e guidance batem", (slug) => {
    expect(noSql(CRITERIA_RUBRICS[slug].title), `título de ${slug}`).toBe(true)
    // a description multi-linha entra concatenada com chr(10): comparo linha a linha
    for (const linha of CRITERIA_INFO[slug].description.split("\n")) {
      expect(noSql(linha), `descrição de ${slug}`).toBe(true)
    }
    for (const faixa of CRITERIA_RUBRICS[slug].ranges) {
      expect(noSql(faixa), `faixa de ${slug}`).toBe(true)
    }
    for (const g of CRITERIA_RUBRICS[slug].guidance ?? []) {
      expect(noSql(g), `guidance de ${slug}`).toBe(true)
    }
  })

  /**
   * 🔴 A ORDEM é dado, não acaso: `sync-constants` ordena por `display_order`, e é ela que põe
   * `fantasy`/`setting_era` nas posições 3 e 4 (onde o c1 os coloca). Sem esta amarra, a 198
   * poderia numerar diferente e o prompt sairia com outra ordem que o arquivo gerado.
   */
  it("o display_order da 198 reproduz a ordem de CRITERION_SLUGS", () => {
    CRITERION_SLUGS.forEach((slug, i) => {
      const ordem = i + 1
      const naCriacao = new RegExp(`'${slug}', '[^']*', \\d+, '[^']*', ${ordem},`).test(SQL)
      const noUpdate = new RegExp(
        `display_order = ${ordem},[\\s\\S]{0,4000}?where slug = '${slug}' and eval_type = 'IA'`,
      ).test(SQL)
      expect(naCriacao || noUpdate, `${slug} deveria ter display_order ${ordem}`).toBe(true)
    })
  })

  it("a 198 não cria critério de IA que as constantes não conhecem", () => {
    const criados = [...SQL.matchAll(/\('IA', '([a-z_]+)'/g)].map((m) => m[1])
    for (const slug of criados) {
      expect(CRITERION_SLUGS as readonly string[], `${slug} criado e ausente das constantes`)
        .toContain(slug)
    }
  })
})
