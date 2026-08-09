import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"

/**
 * `couple_dynamics` é o ÚNICO dos 9 critérios cuja escala é de VALÊNCIA
 * (0-3 = a relação faz mal aos personagens, 9-10 = faz bem). Os outros 8 são de
 * PRESENÇA (0 = o critério não está lá). Até v22 as meta-regras de presença —
 * piso de 5, "ausência de evidência não é evidência de ausência", coerência
 * justificativa×faixa — eram aplicadas aos 9, e a seção de sinais indiretos
 * mapeava `"possessive but I love it" → 0-3`, transformando a PREFERÊNCIA de quem
 * leu na valência da relação.
 *
 * Medido no clone local antes da v23 (2.393 avaliações):
 *  - couple_dynamics era o mais instável dos 9 — amplitude média de 1,52 ponto
 *    entre reavaliações da MESMA obra, 36,7% variando ≥2 pontos, pior caso 6,0;
 *  - justificativa citando posse/ciúme/yandere caía em 0-3 em 19,1% dos casos,
 *    contra 5,4% quando não citava (3,5×), média 5,34 contra 6,16.
 *
 * Este teste lê o texto FINAL do prompt (já com as rubricas interpoladas) porque
 * é ele que vai pro modelo — um teste que checasse só a existência da constante
 * passaria verde com a regra fora do prompt.
 */
describe("SYSTEM_PROMPT — couple_dynamics é escala de VALÊNCIA", () => {
  it("declara as duas naturezas de escala e nomeia couple_dynamics como a exceção", () => {
    expect(SYSTEM_PROMPT).toContain("DUAS NATUREZAS DE ESCALA")
    expect(SYSTEM_PROMPT).toMatch(/couple_dynamics é de VALÊNCIA/)
  })

  it("isenta couple_dynamics das três meta-regras de presença", () => {
    // Sem a isenção, "se há QUALQUER evidência de presença → ≥5" proíbe nota baixa
    // sempre que existir um casal, e "recorrente" na justificativa empurraria uma
    // relação conflituosa para a faixa 7-8 (= relação SAUDÁVEL).
    for (const heading of [
      "COERÊNCIA JUSTIFICATIVA × FAIXA",
      "INTERPRETAÇÃO DA ESCALA",
      'PRINCÍPIO "AUSÊNCIA DE EVIDÊNCIA NÃO É EVIDÊNCIA DE AUSÊNCIA"',
    ]) {
      const idx = SYSTEM_PROMPT.indexOf(heading)
      expect(idx, `seção ausente do prompt: ${heading}`).toBeGreaterThan(-1)
      const line = SYSTEM_PROMPT.slice(idx, SYSTEM_PROMPT.indexOf("\n", idx))
      expect(line, `${heading} não isenta couple_dynamics`).toContain("couple_dynamics")
    }
  })

  it("não mapeia trope de posse/obsessão direto para a faixa 0-3", () => {
    // A linha da v22 era: `"Toxic ship", "yandere", "obsessive ML/FL",
    // "possessive but I love it" → dinâmica tóxica/intensa (0-3)`. Ela contradizia
    // a regra dedicada logo abaixo, que manda checar consenso/satisfação/tom antes.
    const linhas = SYSTEM_PROMPT.split("\n").filter((l) => /toxic ship|yandere|obsessive/i.test(l))
    expect(linhas.length, "a linha de tropes de dinâmica sumiu do prompt").toBeGreaterThan(0)
    for (const linha of linhas) {
      const concluiFaixaBaixa = /→[^\n]*\b0-3\b/.test(linha) && !/NÃO conclua 0-3/.test(linha)
      expect(concluiFaixaBaixa, `trope mapeado direto pra 0-3: ${linha}`).toBe(false)
    }
  })

  it("marca entusiasmo do leitor pelo trope como preferência, não como valência", () => {
    // "possessive but I love it" era o caso mais claro: a leitora declarando que
    // GOSTA virava nota 0-3.
    const linha = SYSTEM_PROMPT.split("\n").find((l) => /possessive but I love it/i.test(l))
    expect(linha, '"possessive but I love it" saiu do prompt sem substituto').toBeTruthy()
    expect(linha).toMatch(/PREFERÊNCIA/)
    expect(linha).toMatch(/ZERO/)
  })

  it("proíbe usar opinião do leitor como valência e manda buscar a reação do personagem", () => {
    expect(SYSTEM_PROMPT).toContain("OPINIÃO DE LEITOR NÃO DEFINE A VALÊNCIA")
    expect(SYSTEM_PROMPT).toContain("A REAÇÃO DO OUTRO PERSONAGEM É O SINAL DECISIVO")
    // Sem indício de reação, a tag de posse não pode sustentar nota baixa sozinha.
    expect(SYSTEM_PROMPT).toMatch(/PERDE PESO|PERDE peso/)
  })

  it("carrega as quatro checagens (a)–(d), incluindo a linha do tempo", () => {
    for (const check of ["(a) CONSENSO", "(b) SATISFAÇÃO", "(c) TOM", "(d) LINHA DO TEMPO"]) {
      expect(SYSTEM_PROMPT, `checagem ausente: ${check}`).toContain(check)
    }
    // (d): em regressão/reencarnação/transmigração, o tóxico da vida ANTERIOR é
    // contexto estabelecido — mesma lógica que tragedy já aplica ao background.
    const idx = SYSTEM_PROMPT.indexOf("(d) LINHA DO TEMPO")
    const bloco = SYSTEM_PROMPT.slice(idx, idx + 600)
    for (const termo of ["reencarnação", "regressão", "transmigração", "CONTEXTO ESTABELECIDO"]) {
      expect(bloco, `(d) não menciona ${termo}`).toContain(termo)
    }
  })

  it("mantém o arco de redenção fora da faixa 0-3", () => {
    expect(SYSTEM_PROMPT).toContain("ARCO DE REDENÇÃO E PERDÃO")
    expect(SYSTEM_PROMPT).toContain("abusador NÃO-arrependido")
  })
})

/**
 * O texto do prompt fica ATRELADO à `PROMPT_VERSION`, que entra na chave de cache
 * (`canonicalInputHash`) e é gravada em `ai_evaluations.prompt_version`.
 *
 * Sem esta trava, editar o prompt sem trocar a versão faz duas coisas silenciosas:
 * o cache serve avaliações da régua ANTIGA como se fossem da nova, e o rótulo no
 * banco mente sobre qual rubrica produziu cada nota. Medido em 2026-08-09: as notas
 * VIGENTES do catálogo vêm de 9 versões diferentes (v22 cobre 9,4% das obras), e a
 * amplitude entre reavaliações cai de 1,52 para 0,45 ponto quando se controla por
 * mesmo modelo + mesma versão — ou seja, ~70% da instabilidade medida vem da régua
 * ter mudado, não do modelo.
 *
 * ⚠️ Ao mudar o prompt de propósito: bump da `PROMPT_VERSION` + atualize o hash
 * abaixo, NA MESMA mudança. O hash cobre também as rubricas interpoladas de
 * `CRITERIA_RUBRICS` — se `sync-constants` alterar uma faixa, a régua mudou de
 * verdade e a versão também precisa mudar.
 */
describe("PROMPT_VERSION acompanha o texto do prompt", () => {
  /** Versão e sha256 do SYSTEM_PROMPT andam JUNTOS — atualize os dois na mesma mudança. */
  const PINNED_VERSION = "v23"
  const PINNED_SHA256 = "82f1630df1a75492506026c90edbaf779a65fb75a7e0fb1976977d9d5f4dd27f"

  it("está fixada na versão que este hash descreve", () => {
    expect(PROMPT_VERSION).toBe(PINNED_VERSION)
  })

  it("o hash do prompt bate com o congelado para esta versão", () => {
    const actual = createHash("sha256").update(SYSTEM_PROMPT).digest("hex")
    expect(
      actual,
      "O SYSTEM_PROMPT mudou. Se foi de propósito, faça bump da PROMPT_VERSION e atualize PINNED_SHA256 neste teste — na MESMA mudança, senão o cache serve avaliações da régua antiga e o rótulo no banco mente.",
    ).toBe(PINNED_SHA256)
  })
})
