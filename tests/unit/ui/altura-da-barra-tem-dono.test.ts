import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

/**
 * A barra superior é `sticky top-0 z-40` DENTRO do mesmo scroller que o resto da página (o
 * `div` do AppShell — o `body` é `h-dvh overflow-hidden` e a página não rola). Logo, quem
 * grudar acima da altura dela fica ATRÁS dela: sem erro, sem corte, sem rolagem.
 *
 * 🔴 Foi o que aconteceu com o `<thead>` das duas tabelas. Ele grudava em `-top-5 md:-top-7`
 * (−28px) e a barra cobre 0..57, então ele parava INTEIRO atrás dela. Medido em 19/08/2026:
 * o cabeçalho sumia a partir de scroll 837px e **~30 das 40 linhas eram lidas sem ele**, nos
 * dois modos do /ranking e também no /catalog. Ninguém tinha reportado em meses — o `sticky`
 * "funcionava" no sentido CSS, e só não era visível.
 *
 * O valor tem dono: `--top-nav-h`. Eram QUATRO cópias manuais dele (68px no ⌘K, 72px e 57px
 * no dicionário, e a conta implícita nas tabelas) e nenhuma constante.
 */

const raiz = process.cwd()
const arquivos = execFileSync("git", ["ls-files", "app", "components"], { cwd: raiz, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f))

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("a altura da barra superior tem um dono só", () => {
  it("`--top-nav-h` está declarada no globals.css", () => {
    const css = readFileSync(`${raiz}/app/globals.css`, "utf8")
    expect(css).toMatch(/--top-nav-h:\s*\d+px/)
  })

  it("ninguém escreve a altura da barra à mão", () => {
    // Faixa 40–120px: é onde cai "a barra" (57) e "a barra + respiro" (68, 72). Fora dela o
    // número não é sobre a barra e não interessa a esta régua.
    const infratores: string[] = []
    for (const f of arquivos) {
      const src = semComentarios(readFileSync(`${raiz}/${f}`, "utf8"))
      for (const m of src.matchAll(/(?:^|[\s"'`:])(?:[a-z]+:)?(top|scroll-mt)-\[(\d+)px\]/g)) {
        const px = Number(m[2])
        if (px >= 40 && px <= 120) infratores.push(`${f}: ${m[1]}-[${px}px]`)
      }
    }
    expect(
      infratores,
      "derive de `--top-nav-h` — ex.: `top-[var(--top-nav-h)]` ou " +
        "`top-[calc(var(--top-nav-h)+11px)]`:\n" + infratores.join("\n"),
    ).toEqual([])
  })

  it("cabeçalho sticky de tabela não gruda ACIMA da barra", () => {
    // O defeito é o offset NEGATIVO: ele põe o cabeçalho atrás da barra. Um `top` positivo
    // menor que a barra falharia igual, e é por isso que a régua exige a variável — o número
    // certo é propriedade dela, não de quem escreve a classe.
    const ruins: string[] = []
    for (const f of arquivos) {
      const src = semComentarios(readFileSync(`${raiz}/${f}`, "utf8"))
      for (const m of src.matchAll(/<(?:thead|TableHeader)\s+className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2] ?? ""
        if (!cls.includes("sticky")) continue
        if (/(?:^|\s)(?:[a-z]+:)?-top-/.test(cls)) ruins.push(`${f}: offset negativo — fica atrás da barra`)
        else if (!cls.includes("--top-nav-h")) ruins.push(`${f}: sticky sem derivar de --top-nav-h`)
      }
    }
    expect(ruins, ruins.join("\n")).toEqual([])
  })

  it("a própria barra deriva da variável, senão o dono não é dono", () => {
    // Sem isto, `--top-nav-h` seria só uma 5ª cópia: a barra mudaria de altura e a variável
    // continuaria afirmando a antiga. O −1px é o `border-b` (box-sizing: border-box).
    const nav = readFileSync(`${raiz}/components/layout/top-nav.tsx`, "utf8")
    expect(nav).toMatch(/h-\[calc\(var\(--top-nav-h\)[^\]]*\)\]/)
    expect(semComentarios(nav)).not.toMatch(/(?:^|\s)h-14(?:\s|")/)
  })
})
