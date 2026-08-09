import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))

import { AiProvenanceSeal, formatProvenanceDate } from "@/components/ui/ai-provenance"

/**
 * O selo de proveniência de IA, em RENDER.
 *
 * De render de propósito: o que regride nesta classe é ESCOPO e TRATAMENTO, e nenhum
 * dos dois aparece numa função pura. Um teste que varresse o source atrás de
 * `formatProvenanceDate` passaria com o selo mostrando "—" no lugar de "sem registro",
 * ou desenhando `text-foreground` dentro do tooltip invertido — que é texto INVISÍVEL
 * (`components/ui/tooltip.tsx` é `bg-foreground` + `text-background`).
 *
 * O tooltip do Radix só monta no hover/foco, então os casos abaixo checam o GATILHO e a
 * pureza dos formatadores; o corpo é coberto pelo `defaultOpen` do Radix via `open`.
 */

afterEach(cleanup)

describe("formatProvenanceDate", () => {
  it("formata por SLICE do ISO, não pelo fuso de quem renderiza", () => {
    // 🔴 O selo renderiza no server component da obra E em cards client. Com
    // `toLocaleDateString` o HTML do SSR sairia com uma data e o primeiro render do
    // cliente com outra (fusos diferentes), quebrando a hidratação. Este ISO é o caso
    // que denuncia: 00:30 UTC vira o DIA ANTERIOR em qualquer fuso negativo.
    expect(formatProvenanceDate("2026-08-08T00:30:00.000Z")).toBe("08/08/2026")
  })

  it("devolve null pra data ausente, em vez de inventar um dia", () => {
    expect(formatProvenanceDate(null)).toBeNull()
    expect(formatProvenanceDate(undefined)).toBeNull()
    expect(formatProvenanceDate("")).toBeNull()
  })
})

describe("AiProvenanceSeal", () => {
  it("aparece MESMO sem modelo — o selo é a marca de 'isto é de IA', não só o botão", () => {
    // Esconder o selo quando o modelo é desconhecido apagaria o fato de aquele texto ser
    // gerado por um modelo — que é justamente o que ele existe pra comunicar. Medido:
    // 67% das obras com sinopse canônica não têm modelo recuperável.
    render(<AiProvenanceSeal title="Sinopse consolidada por IA" model={null} at={null} />)
    expect(screen.getByRole("button", { name: /Sinopse consolidada por IA/ })).toBeTruthy()
  })

  it("o gatilho não imprime a data na tela — ela mora no tooltip", () => {
    // A régua inteira é 'nenhuma proveniência solta na tela'. Um selo que imprimisse a
    // data ao lado do título devolveria a faixa de meta que estamos tirando.
    const { container } = render(
      <AiProvenanceSeal title="Avaliação por IA" model="claude-sonnet-5" at="2026-08-08T03:47:00Z" />,
    )
    expect(container.textContent).not.toContain("08/08/2026")
    expect(container.textContent).not.toContain("claude-sonnet-5")
  })

  it("com `label`, o rótulo aparece — rodapé de vários itens precisa dele", () => {
    render(<AiProvenanceSeal title="Inferência de tags" label="inferência" at="2026-07-20T14:08:00Z" />)
    expect(screen.getByText("inferência")).toBeTruthy()
  })

  it("é <button> de verdade: o tooltip precisa abrir no foco por teclado", () => {
    render(<AiProvenanceSeal title="Avaliação por IA" model="claude-sonnet-5" />)
    const trigger = screen.getByRole("button", { name: /Avaliação por IA/ })
    expect(trigger.tagName).toBe("BUTTON")
    // type="button": sem isso, dentro de um <form> o selo VIRA SUBMIT — e o formulário
    // pós-leitura ("Atributos da obra") é exatamente um desses.
    expect(trigger.getAttribute("type")).toBe("button")
  })

  it("o corpo do tooltip não usa cor da PÁGINA — só opacidade da cor dele mesmo", () => {
    // O `TooltipContent` do app é invertido (`bg-foreground` + `text-background`), e os
    // dois tokens de página falham nele, cada um de um jeito:
    //  · `text-foreground`        → texto da cor do fundo: INVISÍVEL nos dois temas.
    //  · `text-muted-foreground`  → passa no escuro e quase some no CLARO (medido em
    //    2026-08-08: cinza hsl(224 9% 43%) sobre o quase-preto do tooltip, ~3:1). É o
    //    caso pior, porque metade dos temas fica verde e a convenção sobrevive.
    // O que funciona nos dois é `text-background/<alfa>`: opacidade da própria cor do
    // texto do tooltip.
    //
    // 🔴 Lê o ARQUIVO, não `AiProvenanceSeal.toString()`: o corpo do tooltip é desenhado
    // por `ProvenanceRow`, função separada que não aparece no toString do selo. A 1ª versão
    // deste teste passava verde sem enxergar justamente a metade que importa.
    const source = readFileSync(
      resolve(__dirname, "../../../components/ui/ai-provenance.tsx"),
      "utf8",
    )
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toContain("text-foreground")
    expect(code).not.toContain("text-muted-foreground")
  })
})
