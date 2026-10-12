import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

/**
 * A versão PADRÃO de uma obra mixed segue a preferência de 18+ (decisão de 2026-10-12, D3) — e
 * `user_settings.preferred_mixed_edition` (mig 213) saiu da experiência: sem controle em
 * /preferences, sem action, sem leitor. A COLUNA fica no banco (sem migration para apagá-la).
 *
 *   · a padrão da TELA vem da sessão: anônimo ⇒ normal; logado ⇒ a régua de ocultar 18+ dele;
 *   · a padrão do RECÁLCULO vem de um usuário EXPLÍCITO (sem sessão em background);
 *   · ninguém no app lê a coluna antiga — senão ela voltaria a decidir em silêncio.
 */
const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "")

describe("a preferência de versão saiu da experiência", () => {
  it("o controle foi removido e /preferences não o monta", () => {
    expect(existsSync(join(process.cwd(), "components/settings/mixed-edition-preference.tsx"))).toBe(false)
    const prefs = semComentarios(ler("app/preferences/page.tsx"))
    expect(prefs).not.toMatch(/MixedEditionPreference/)
    expect(prefs).toMatch(/HideAdultContentToggle/)
  })
  it("nenhum código do app lê ou grava `preferred_mixed_edition` (nem a action antiga existe)", () => {
    const arquivos = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "app", "components", "lib", "server", "types"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(join(process.cwd(), f)))
    expect(arquivos.length).toBeGreaterThan(100)
    const culpados = arquivos.filter((f) => /preferred_mixed_edition|setPreferredMixedEdition|getPreferredMixedEdition/.test(semComentarios(ler(f))))
    expect(culpados).toEqual([])
  })
})

describe("de onde vem o contexto da versão padrão", () => {
  const editionScores = semComentarios(ler("server/queries/edition-scores.ts"))

  it("na TELA: `signedIn` sai da SESSÃO e ocultar 18+ da linha da sessão (anônimo nunca vira dono)", () => {
    const corpo = editionScores.slice(editionScores.indexOf("export const getMixedEditionSettings"))
    const fn = corpo.slice(0, corpo.indexOf("})"))
    expect(fn).toMatch(/getSessionUserId\(\)/)
    expect(fn).toMatch(/signedIn: sessionId != null/)
    expect(fn).toMatch(/getHideAdultContent\(\)/)
    expect(fn).not.toMatch(/getCurrentUserId|getOwnerUserId/)
    // `getHideAdultContent` lê a linha memoizada da SESSÃO, que é null sem sessão.
    const currentUser = semComentarios(ler("server/queries/current-user.ts"))
    const row = currentUser.slice(currentUser.indexOf("const getCurrentUserSettingsRow"))
    expect(row.slice(0, row.indexOf("})"))).toMatch(/if \(!sessionId\) return null/)
  })
  it("no RECÁLCULO: lê só `hide_adult_content` de um usuário EXPLÍCITO e o trata como logado", () => {
    const corpo = editionScores.slice(editionScores.indexOf("export async function loadMixedEditionSettingsFor"))
    const fn = corpo.slice(0, corpo.indexOf("\n}"))
    expect(fn).toMatch(/userId: string/)
    expect(fn).toMatch(/\.select\("hide_adult_content"\)/)
    expect(fn).toMatch(/\.eq\("current_user_id", userId\)/)
    expect(fn).toMatch(/signedIn: true/)
  })
  it("trocar a versão na página não grava preferência nenhuma (o seletor é navegação)", () => {
    expect(ler("components/titles/edition-selector.tsx")).not.toMatch(/server\/actions/)
  })
  it("a página da obra passa a sessão e os extras à régua", () => {
    const page = semComentarios(ler("app/catalog/[id]/page.tsx"))
    const chamada = page.slice(page.indexOf("resolveMixedEdition({"), page.indexOf("resolveMixedEdition({") + 400)
    expect(chamada).toMatch(/signedIn: editionSettings\?\.signedIn/)
    expect(chamada).toMatch(/r18OnlyInExtras: r18ExtrasWorkIds\?\.has\(/)
  })
})
