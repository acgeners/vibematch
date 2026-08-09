import { describe, expect, it } from "vitest"

import { SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"

/**
 * Quatro critérios haviam colapsado numa faixa só, e feature quase-constante não
 * contribui nada pro Ridge da Nota Prevista nem discrimina no `/ranking`.
 *
 * Medido em 2.393 avaliações (clone local, 2026-08-09), share por faixa:
 *
 *   action_adventure   19,9% | 73,5% |  6,6% |  0,0%   σ 1,31
 *   protagonist         0,1% | 18,8% | 77,4% |  3,7%   σ 0,87  ← o menos informativo
 *   romance             1,5% | 16,3% | 73,7% |  8,4%   σ 1,16
 *   fantasy_nobility    3,4% |  7,4% | 76,2% | 13,0%   σ 1,42
 *
 * Quatro mecanismos distintos, cada um com seu teste abaixo. Todos produziam nota
 * plausível — a contradição só aparece lendo a justificativa ao lado do número.
 */
describe("SYSTEM_PROMPT — o piso de 5 não se sobrepõe à rubrica", () => {
  it("declara que evidência positiva de ausência vence o piso", () => {
    // Medido: das 1.027 justificativas de action_adventure que afirmam ausência
    // ("slice of life", "uneventful", "nada acontece"), 316 (30,8%) ficaram ≥5. A
    // faixa 0-3 do critério diz literalmente "cotidiano, sem conflito externo
    // relevante (slice of life)" — a prosa citava a definição da faixa e a nota não ia.
    expect(SYSTEM_PROMPT).toMatch(/O piso NÃO se sobrepõe à rubrica/)
    expect(SYSTEM_PROMPT).toMatch(/Evidência positiva de ausência VENCE o piso/)
  })

  it("mantém explícito o que o piso AINDA protege", () => {
    // O piso não pode simplesmente sumir: ele existe contra dois vieses reais
    // (execução fraca e silêncio das fontes). Sem esta linha, a correção de um viés
    // reabre o outro.
    expect(SYSTEM_PROMPT).toMatch(/EXECUÇÃO FRACA e baixar por SILÊNCIO das fontes/)
    expect(SYSTEM_PROMPT).toMatch(/Críticas, tropos clichês ou execução fraca NÃO justificam baixar/)
  })
})

describe("SYSTEM_PROMPT — a posição dentro da faixa segue a intensidade declarada", () => {
  it("manda usar o extremo da faixa que o próprio texto descreve", () => {
    // Medido entre notas 4–6,9: a prosa com "pontual/esporádico/não domina" distribuía
    // 31/32/35% (em 4–4,9 / 5 / >5) contra 33/35/31% da prosa neutra — distribuições
    // idênticas. A palavra "pontual" na justificativa não mudava o número. É o caso da
    // obra que escreveu "eventos pontuais, sem dominar o tom geral" e pontuou 6,0.
    const idx = SYSTEM_PROMPT.indexOf("POSIÇÃO DENTRO DA FAIXA")
    expect(idx, "a regra de posição dentro da faixa sumiu").toBeGreaterThan(-1)
    const bloco = SYSTEM_PROMPT.slice(idx, idx + 900)
    expect(bloco).toMatch(/MAIS BAIXO da faixa/)
    expect(bloco).toMatch(/MAIS ALTO/)
    expect(bloco).toMatch(/valor central/)
  })

  it("dá precedência sobre as duas regras que puxavam pro meio e pro topo", () => {
    // Sem precedência explícita, "prefira o valor CENTRAL" e "use o valor mais alto da
    // faixa inferior" continuam valendo e a nova regra vira letra morta.
    const idx = SYSTEM_PROMPT.indexOf("POSIÇÃO DENTRO DA FAIXA")
    const bloco = SYSTEM_PROMPT.slice(idx, idx + 1200)
    expect(bloco).toMatch(/PRECEDÊNCIA/)
    expect(bloco).toMatch(/empate REAL/)
  })
})

describe("SYSTEM_PROMPT — reencarnação/regressão não é estrutura de fantasia", () => {
  it("trata os tropos de linha do tempo como DISPOSITIVO, não como evidência estrutural", () => {
    // Medido: justificativa de fantasy_nobility citando o gatilho (reencarnação /
    // regressão / transmigração / isekai) → 97,9% ≥7 e média 8,11; sem citar → 81,1%
    // e 7,14. Como 48% das avaliações citam o gatilho num catálogo majoritariamente
    // isekai/vilã, a "REGRA OBRIGATÓRIA" tinha virado um piso que não distingue nada.
    const idx = SYSTEM_PROMPT.indexOf("REGRA PARA FANTASY_NOBILITY")
    expect(idx, "a seção de fantasy_nobility sumiu ou voltou a ser OBRIGATÓRIA").toBeGreaterThan(-1)
    const bloco = SYSTEM_PROMPT.slice(idx, idx + 1400)
    expect(bloco).toMatch(/DISPOSITIVOS NARRATIVOS/)
    expect(bloco).toMatch(/Sozinhos, NÃO elevam a nota/)
    // O antídoto contra regra que dispara em todo mundo.
    expect(bloco).toMatch(/copiada para metade das obras/)
  })
})

describe("SYSTEM_PROMPT — protagonist mede presença E agência", () => {
  it("impede 7-8 para protagonista passivo, por mais marcante que seja", () => {
    // A rubrica 0-3 abre com "sem agência, decisões irrelevantes", mas o gate do prompt
    // só autorizava faixa baixa pra "ESQUECÍVEL / GENÉRICO / SEM PERSONALIDADE /
    // SUBSTITUÍVEL" — agência não estava na lista. Medido: das 151 justificativas que
    // chamam o protagonista de passivo/sem agência, 51% ficaram ≥7 (a faixa que exige
    // "agência clara, decisões movem a trama") e só 9 abaixo de 5.
    expect(SYSTEM_PROMPT).toMatch(/PRESENÇA e AGÊNCIA são as DUAS metades/)
    expect(SYSTEM_PROMPT).toMatch(/personalidade forte NÃO compensa agência ausente/i)
    expect(SYSTEM_PROMPT).toMatch(/SEM AGÊNCIA, com decisões irrelevantes/)
  })

  it("preserva a distinção entre COMO ele é e O QUE ele faz", () => {
    // A regra antiga existia por um motivo real: "Mary Sue", "irritante" e "fria" são
    // críticas de QUALIDADE e confirmam presença forte. Corrigir a agência não pode
    // reabrir esse viés — por isso as duas listas ficam separadas e nomeadas.
    expect(SYSTEM_PROMPT).toMatch(/são sobre COMO ele é, e não rebaixam/)
    expect(SYSTEM_PROMPT).toMatch(/são sobre O QUE ELE FAZ, e rebaixam/)
    expect(SYSTEM_PROMPT).toMatch(/"Personagem desagradável de acompanhar" continua sendo 7-8/)
  })
})
