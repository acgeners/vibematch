import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, it, expect } from "vitest"

/**
 * `redirect()` no caminho de RENDER de um `page.tsx` derruba a página — e só em load direto.
 *
 * 🔴 O mecanismo, medido em 2026-08-08 e remedido em 20/08: `redirect()` num server component
 * NÃO devolve 3xx. O layout já começou a streamar, o Next responde **200** e manda o cliente
 * navegar; o Router estoura com "Rendered more hooks than during the previous render"
 * (React #310 minificado em produção).
 *
 * ⚠️ Por dois anos-luz isso pareceu cosmético: o erro ia pro console e a página funcionava,
 * então virou resíduo aceito. Em 19/08 a grade compacta dos 9 critérios aumentou a árvore
 * hidratada da página da obra e o erro deixou de ser recuperável. Medido em PRODUÇÃO em
 * 20/08, 10 aberturas por UUID (a URL que redirecionava) e 5 por slug (a que não):
 *
 * | abertura direta | quebrou | erro no console |
 * |---|---|---|
 * | UUID → redirect para o slug | **9 de 10** | 10 de 10 |
 * | slug, sem redirect | 0 de 5 | 0 de 5 |
 *
 * Ou seja: a severidade dessa família NÃO é estável — ela depende do tamanho da árvore, que
 * cresce sozinha a cada card novo. É por isso que o teste exige DECLARAÇÃO em vez de confiar
 * em "hoje é só um warning".
 *
 * A régua: alias de rota nasce no `redirects()` do `next.config.ts` (308 de verdade). Quando a
 * decisão precisa de DADO, ou vai pro proxy, ou os links param de passar pela rota que
 * redireciona, ou o `redirect()` fica — e aí **declara o motivo**, encostado nele:
 *
 *     // redirect-em-render: <por que não dá pra tirar, e qual o custo aceito>
 *
 * ⚠️ Ele casa o FATO (existe `redirect(` no arquivo ⇒ existe declaração), nunca a grafia de
 * uma implementação. E deriva a lista de páginas do GIT — lista fixa não acha a rota que
 * alguém adicionar amanhã, que é exatamente o caso que isto existe pra pegar.
 */

const RAIZ = resolve(__dirname, "../../..")

function pagesDoGit(): string[] {
  return execFileSync("git", ["ls-files", "app"], { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .filter((f) => /(^|\/)page\.tsx$/.test(f))
}

/** Sem comentários de bloco nem de linha — mas PRESERVA os marcadores, que são o que se conta. */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => (m.includes("redirect-em-render") ? m : ""))
    .replace(/\/\/.*$/gm, (m) => (m.includes("redirect-em-render") ? m : ""))
}

describe("redirect() em page.tsx", () => {
  const paginas = pagesDoGit()

  it("o universo vem do git e não está vazio", () => {
    expect(paginas.length).toBeGreaterThan(20)
  })

  it("toda página que redireciona no render DECLARA o motivo", () => {
    const semMotivo: string[] = []
    for (const rel of paginas) {
      const src = semComentarios(readFileSync(resolve(RAIZ, rel), "utf8"))
      // `redirect(` de verdade — não `permanentRedirect`, não `redirects(` do config.
      if (!/(?<![\w.])redirect\s*\(/.test(src)) continue
      if (!src.includes("redirect-em-render:")) semMotivo.push(rel)
    }
    expect(
      semMotivo,
      `redirect() sem motivo declarado. Ou tire (alias → next.config, decisão de sessão → proxy), ` +
        `ou escreva "// redirect-em-render: <motivo e custo aceito>" encostado nele:\n  ${semMotivo.join("\n  ")}`,
    ).toEqual([])
  })

  it("o motivo é uma frase, não um carimbo vazio", () => {
    for (const rel of paginas) {
      const src = readFileSync(resolve(RAIZ, rel), "utf8")
      const m = src.match(/redirect-em-render:(.*)/)
      if (!m) continue
      expect(m[1].trim().length, `${rel}: o marcador está sem motivo escrito`).toBeGreaterThan(25)
    }
  })

  it("a página da obra NÃO redireciona — ela serve a URL pedida e declara o canonical", () => {
    // 🔴 O caso medido: é esta rota que quebrava 9 em 10. O canonical é o que substitui o
    // redirect, então testar só a ausência do redirect deixaria passar a metade que informa
    // aos buscadores qual URL vale.
    for (const rel of ["app/catalog/[id]/page.tsx", "app/catalog/[id]/edit/page.tsx"]) {
      const src = semComentarios(readFileSync(resolve(RAIZ, rel), "utf8"))
      expect(/(?<![\w.])redirect\s*\(/.test(src), `${rel} voltou a redirecionar no render`).toBe(false)
    }
    const detalhe = readFileSync(resolve(RAIZ, "app/catalog/[id]/page.tsx"), "utf8")
    expect(detalhe).toMatch(/alternates:\s*\{\s*canonical/)
  })
})
