import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante: o recálculo GLOBAL só é FORÇADO por um dono declarado.
 *
 * 🔴 Por que uma varredura e não um teste por arquivo. O fix do E2 nasceu olhando UM
 * call site (`server/actions/generate-all.ts`) e o teste original afirmava só que a
 * string tinha sumido DAQUELE arquivo. A reconciliação de 2026-09-25 achou outros TRÊS
 * em `server/comix/resolver.ts` — um deles dentro de um `for` sobre o lote, outro na
 * fase 0 gratuita da cascata. Um teste ancorado num arquivo não os via, e não veria o
 * próximo. Esta varredura pergunta ao DIRETÓRIO, e por isso acha o que ninguém apontou.
 *
 * A régua não é "ninguém pode chamar": é "quem chama está numa lista com MOTIVO". Chamar
 * de um caminho POR OBRA é o defeito; chamar de um gatilho global (um toggle de fórmula,
 * o botão, o fim de um lote) é o uso correto.
 *
 * ⚠️ Comentários são removidos antes da varredura: os arquivos corrigidos CITAM
 * `recalculateScoresNow()` para explicar o que deixaram de fazer, e casar a citação
 * transformaria a explicação da correção em falha. Foi o que já aconteceu em
 * `abas-da-obra.test.ts`.
 */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
  }
  return out
}

/** Tira comentários de bloco e de linha — a citação em prosa não é chamada. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/**
 * Quem pode FORÇAR o recálculo global, e por quê. Todos são gatilhos GLOBAIS — um por
 * ação do usuário, nunca um por obra.
 */
const DONOS: Record<string, string> = {
  "server/recalc/queue.ts": "define e expõe o runner (é o dono)",
  // ⚠️ `server/actions/recalc-queue.ts` NÃO entra: ele chama `impl.triggerRecalcNow()`,
  // não `recalculateScoresNow(`. E `interest-backfill.ts` recebe o recalc INJETADO.
  // Os dois estavam nesta lista na 1ª versão e o caso do "dono morto" os expulsou —
  // é ele que impede a allowlist de virar prosa que ninguém confere.
  "server/actions/settings.ts": "toggles de fórmula — mudam a régua do catálogo inteiro",
  "server/actions/calibration.ts": "painel de calibração — global por natureza",
  "server/actions/post-reading-weight-suggestions.ts": "aplicar pesos — muda a régua",
  "server/actions/works.ts": "finalizePendingBatch(): UMA vez ao fechar o lote, não por obra",
}

const CHAMADA = /\brecalculateScoresNow(Result)?\s*\(/

describe("arquitetura: recalc global só em dono declarado", () => {
  const arquivos = ["server", "lib", "app", "components"].flatMap((d) => walk(d))

  it("nenhum arquivo fora da lista FORÇA recalc global", () => {
    const intrusos = arquivos.filter((f) => !(f in DONOS) && CHAMADA.test(semComentarios(readFileSync(f, "utf8"))))

    expect(
      intrusos,
      `Estes forçam recalc global sem estar na lista de donos.\n` +
        `Se for gatilho GLOBAL (um por ação), acrescente à lista com o motivo.\n` +
        `Se for POR OBRA, use markRecalcPending — foi o defeito do E2:\n  ${intrusos.join("\n  ")}`,
    ).toEqual([])
  })

  it("a lista não acumula dono morto — todo arquivo declarado existe e ainda chama", () => {
    const mortos = Object.keys(DONOS).filter(
      (f) => !arquivos.includes(f) || !CHAMADA.test(semComentarios(readFileSync(f, "utf8"))),
    )
    expect(mortos, `Declarados como donos mas não chamam mais — remova:\n  ${mortos.join("\n  ")}`).toEqual([])
  })

  it("🔴 os caminhos POR OBRA já corrigidos não voltam a forçar", () => {
    for (const f of ["server/actions/generate-all.ts", "server/comix/resolver.ts"]) {
      const src = semComentarios(readFileSync(f, "utf8"))
      expect(CHAMADA.test(src), `${f} voltou a forçar recalc global`).toBe(false)
      expect(/\bmarkRecalcPending\s*\(/.test(src), `${f} deixou de marcar pendência`).toBe(true)
    }
  })

  it("o mop-up de lote marca UMA vez, fora do laço", () => {
    const src = semComentarios(readFileSync("server/comix/resolver.ts", "utf8"))
    // A marcação do lote não pode estar dentro do `for (const id of workIds`.
    const laco = src.indexOf("for (const id of workIds")
    expect(laco).toBeGreaterThan(-1)
    const fimLaco = src.indexOf("}", src.indexOf("{", laco))
    const dentro = src.slice(laco, fimLaco)
    expect(/markRecalcPending\s*\(/.test(dentro), "marcação DENTRO do laço do lote").toBe(false)
  })
})
