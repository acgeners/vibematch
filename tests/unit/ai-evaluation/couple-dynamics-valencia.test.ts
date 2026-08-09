import { describe, expect, it } from "vitest"

import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"

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
/** A seção dedicada do critério, do cabeçalho até a linha em branco dupla seguinte. */
function couple_dynamicsRule(): string {
  const idx = SYSTEM_PROMPT.indexOf("REGRA PARA COUPLE_DYNAMICS")
  expect(idx, "a seção dedicada sumiu do prompt").toBeGreaterThan(-1)
  const end = SYSTEM_PROMPT.indexOf("\n\nREGRA OBRIGATÓRIA PARA TRAGEDY", idx)
  return SYSTEM_PROMPT.slice(idx, end > idx ? end : undefined)
}

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
    expect(linha).toMatch(/o leitor fala DELE|PREFERÊNCIA/)
    expect(linha).toMatch(/sozinho não escolhe faixa/)
  })

  it("NÃO manda descartar a reclamação — ela carrega a reação do personagem", () => {
    // 🔴 A 1ª redação mandava "extraia o FATO e DESCARTE o julgamento" e listava como
    // descartáveis justamente as frases que CARREGAM o fato. Leitor comenta o que o
    // incomodou, e pra isso descreve o que a personagem fez ou sentiu: "ela é idiota de
    // aceitar o ciúme dele" é a evidência mais direta de consentimento que existe.
    const regra = couple_dynamicsRule()
    expect(regra).toMatch(/NÃO DESCARTE A RECLAMAÇÃO/)
    expect(regra).toMatch(/COMO SEPARAR — pelo SUJEITO da frase, não pelo tom/)
  })

  it("dá exemplos de mesmo TOM com faixas OPOSTAS", () => {
    // É isso que prova que o tom não pode decidir. Um exemplo só (ou três do mesmo lado)
    // ensinaria o modelo a mapear "reclamação → faixa X", que é o erro original com outra
    // roupa. Os três casos vêm do uso real relatado pelo dono do catálogo.
    const regra = couple_dynamicsRule()
    // aceitação → 7-8
    expect(regra).toMatch(/ela é idiota de aceitar[^\n]*7-8/)
    // perdão + linha do tempo original → 7-8 e item (d)
    expect(regra).toMatch(/perdoar[^\n]*linha do tempo/)
    expect(regra).toMatch(/ela perdoou/)
    // desconforto ignorado → 0-3
    expect(regra).toMatch(/desconfortável[^\n]*0-3/)
    expect(regra).toMatch(/faixas OPOSTAS/)
  })

  it("trata discordância sobre a REAÇÃO como divergência real, não de gosto", () => {
    const regra = couple_dynamicsRule()
    expect(regra).toMatch(/ABAIXE a "confidence"/)
    expect(regra).toMatch(/Não é o mesmo que divergência de gosto/)
  })

  it("proíbe usar opinião do leitor como valência e manda buscar a reação do personagem", () => {
    expect(SYSTEM_PROMPT).toContain("OPINIÃO DE LEITOR NÃO DEFINE A VALÊNCIA")
    expect(SYSTEM_PROMPT).toContain("A REAÇÃO DO OUTRO LADO DO VÍNCULO É O SINAL DECISIVO")
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

  it("vale para VÍNCULOS CENTRAIS, não só para casal romântico", () => {
    // O critério foi renomeado "Dinâmica do Casal" → "Dinâmica entre Protagonistas"
    // em 95226f7 (2026-07-27) e as FAIXAS da rubrica foram ampliadas junto
    // ("parceiro" → "vínculos centrais", "conduta", "quem é próximo"). Mas o slug
    // continua `couple_dynamics` e a `description` no banco ainda diz "casal
    // principal" — então o bloco do critério no prompt tem título amplo, descrição
    // restrita e rubrica ampla. Sem esta contra-instrução explícita, o modelo segue
    // a palavra "couple" e devolve 5 pra toda obra sem romance.
    const regra = couple_dynamicsRule()
    expect(regra).toContain("VÍNCULO MAIS CENTRAL")
    expect(regra, "a regra não desarma o nome do slug").toMatch(/NOME DO SLUG ENGANA/)
    // Os vínculos não-românticos precisam estar NOMEADOS: "vínculos centrais" sozinho
    // é abstrato demais pra o modelo aplicar a uma obra de shounen ou de família.
    for (const vinculo of ["irmãos", "FAMÍLIA", "mestre e discípulo", "equipe", "rivalidade"]) {
      expect(regra, `vínculo não-romântico ausente: ${vinculo}`).toContain(vinculo)
    }
  })

  it("define a ORDEM de prioridade do vínculo, não uma lista solta", () => {
    // Sem ordem, obra que tem casal E família fica ambígua: dois avaliadores escolhem
    // vínculos diferentes e as notas deixam de ser comparáveis entre si — mesma classe
    // de problema das réguas de prompt misturadas.
    const regra = couple_dynamicsRule()
    expect(regra).toContain("QUAL VÍNCULO AVALIAR")
    expect(regra).toMatch(/PRIMEIRO que a obra tiver/)
    const casal = regra.indexOf("1. o CASAL principal")
    const familia = regra.indexOf("2. a FAMÍLIA")
    const resto = regra.indexOf("3. o restante")
    expect(casal, "prioridade 1 (casal) ausente").toBeGreaterThan(-1)
    expect(familia, "prioridade 2 (família) ausente").toBeGreaterThan(casal)
    expect(resto, "prioridade 3 (demais vínculos) ausente").toBeGreaterThan(familia)
    // O modelo precisa dizer qual vínculo usou, senão a nota não é auditável.
    expect(regra).toMatch(/Diga na justificativa QUAL vínculo/)
  })

  it("a description do critério (que vai colada no prompt) carrega a mesma prioridade", () => {
    // `buildCriteriaPromptSection()` cola CRITERIA_INFO[slug].description ACIMA das
    // faixas. Até a migration 181 ela dizia "a relação entre o casal principal" —
    // descrição restrita dentro de um bloco de título e rubrica já ampliados.
    const desc = CRITERIA_INFO.couple_dynamics?.description ?? ""
    expect(desc).not.toMatch(/relação entre o casal principal/)
    expect(desc).toContain("vínculo MAIS CENTRAL")
    expect(desc.indexOf("casal principal")).toBeLessThan(desc.indexOf("família"))
  })

  it("reserva o 5 pra ausência de VÍNCULO, não pra ausência de romance", () => {
    const regra = couple_dynamicsRule()
    expect(regra).toMatch(/não devolva 5 só porque não há casal/)
    expect(regra).toMatch(/vínculo central recorrente/)
  })

  it("mantém o arco de redenção fora da faixa 0-3", () => {
    expect(SYSTEM_PROMPT).toContain("ARCO DE REDENÇÃO E PERDÃO")
    expect(SYSTEM_PROMPT).toContain("abusador NÃO-arrependido")
  })
})
