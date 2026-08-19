import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  buildScoreGlossary,
  featureKey,
  RECALC_INPUT_LABELS,
  type ScoreEntry,
} from "@/lib/scores/glossary"
import { SCORE_EXCLUSIONS, SCORE_NOTES } from "@/lib/scores/glossary-notes"
import {
  EXPECTED_BASELINE_FEATURES,
  EXPECTED_CATEGORICAL_FEATURES,
} from "@/lib/calculations/expected"
import { RECALC_INPUTS } from "@/lib/calculations/recalc-inputs"
import { LABELS } from "@/lib/constants/ui-labels"
import { CRITERION_SLUGS } from "@/types/domain"

/**
 * O dicionário dos números DERIVA do cálculo, então a defesa não é conferir prosa — é
 * garantir que o cálculo não mude sem a página acompanhar.
 *
 * 🔴 O modo de falha que isto pega: alguém adiciona uma feature ao Ridge (ou renomeia
 * uma), a página continua abrindo, o `tsc` continua passando, e o dicionário passa a
 * descrever um modelo que não é o que roda. Ninguém percebe, porque a página não fica
 * quebrada — fica desatualizada, que é indistinguível de correta para quem lê.
 *
 * É a mesma classe do `CRITERIA_SCALE_LEGEND` (prompt descrevendo faixas que mudaram) e
 * do tooltip do Alinhamento, que passou dois meses explicando uma fórmula aposentada.
 */
describe("dicionário dos números", () => {
  const { medidas, features, controles } = buildScoreGlossary()
  const todos: ScoreEntry[] = [...medidas, ...features, ...controles]

  it("a varredura não nasce vazia", () => {
    // Guarda contra o modo de falha do próprio teste: com os arrays vazios, quase todos
    // os casos abaixo passam por vacuidade.
    expect(medidas.length).toBeGreaterThan(5)
    expect(features.length).toBeGreaterThan(5)
    expect(controles.length).toBeGreaterThan(3)
  })

  it("toda entrada do Ridge tem verbete — feature nova reprova aqui", () => {
    // A checagem que dá sentido à página. `EXPECTED_BASELINE_FEATURES` é a lista real de
    // entradas do modelo; os 9 critérios entram por um verbete só (o dicionário deles já
    // existe), e as categóricas + ArtEstimate completam o vetor.
    const criterios = new Set<string>(CRITERION_SLUGS)
    const esperadas = [
      ...EXPECTED_BASELINE_FEATURES,
      "ArtEstimate",
      ...EXPECTED_CATEGORICAL_FEATURES,
    ].filter((f) => !criterios.has(f))

    const cobertas = new Set(features.map((f) => f.slug))
    for (const f of esperadas) {
      expect(cobertas.has(f), `feature "${f}" entrou no modelo sem verbete no dicionário`).toBe(true)
    }
  })

  it("os 9 atributos entram como UM verbete, apontando para o dicionário deles", () => {
    // Nove verbetes idênticos dizendo "veja o outro dicionário" seriam nove vezes a mesma
    // linha — e a rubrica de verdade mora no banco, então copiá-la aqui é a segunda cópia
    // que este projeto passa a vida caçando.
    const nove = features.find((f) => f.key === "os_nove_atributos")
    expect(nove, "o verbete dos 9 atributos sumiu").toBeDefined()
    expect(nove!.href?.url).toBe("/guide/attributes")
    for (const slug of CRITERION_SLUGS) {
      expect(
        features.some((f) => f.slug === slug),
        `${slug} ganhou verbete próprio — a rubrica dele mora no /guide/attributes`
      ).toBe(false)
    }
  })

  it("todo verbete tem chave única, nome, escala e a frase que resolve", () => {
    const chaves = new Set<string>()
    for (const e of todos) {
      expect(chaves.has(e.key), `chave duplicada: ${e.key}`).toBe(false)
      chaves.add(e.key)
      expect(e.name.length, `${e.key} sem nome`).toBeGreaterThan(2)
      expect(e.scale.length, `${e.key} sem escala`).toBeGreaterThan(0)
      // A "frase que resolve" precisa resolver: uma linha de três palavras não explica
      // número nenhum, e a página tem um parágrafo reservado para ela.
      expect(e.summary.length, `${e.key} com resumo curto demais`).toBeGreaterThan(60)
      expect(e.where.length, `${e.key} não diz onde aparece`).toBeGreaterThan(3)
    }
  })

  it("a âncora de cada verbete é válida numa URL", () => {
    // As features vêm de nomes de código (`IA(n)`, `Nota.M`) e viram id de elemento e
    // fragmento de link. Parêntese e ponto quebram o `#slug` em navegador.
    for (const e of todos) {
      expect(e.key, `${e.key} não serve como âncora`).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it("featureKey normaliza os nomes de código do modelo", () => {
    expect(featureKey("IA(n)")).toBe("ia_n")
    expect(featureKey("Nota.M")).toBe("nota_m")
    expect(featureKey("RunLength")).toBe("run_length")
    expect(featureKey("LogVotos")).toBe("log_votos")
  })

  it("nenhuma ressalva fica órfã de um verbete que não existe mais", () => {
    // Rename de verbete deixaria a nota viva no arquivo e invisível na tela — o mesmo
    // efeito de não tê-la escrito, sem nada acusar.
    const chaves = new Set(todos.map((e) => e.key))
    for (const key of Object.keys(SCORE_NOTES)) {
      expect(chaves.has(key), `ressalva órfã: ${key}`).toBe(true)
    }
  })

  it("as medidas apontam para campos que ainda existem em ui_labels", () => {
    // O nome vem de `LABELS`, então o `tsc` já pega a remoção de um campo. O que ele NÃO
    // pega é o nome vir vazio — `ui_labels` é editável no banco, e um `name_full` em
    // branco renderiza um verbete sem título.
    for (const e of medidas) {
      expect(e.name.trim().length, `${e.key} ficou sem rótulo em ui_labels`).toBeGreaterThan(1)
    }
    expect(LABELS.personal_fit.full).toBe("Alinhamento")
  })

  it("o tooltip do Alinhamento não descreve mais a fórmula aposentada", () => {
    // 🔴 A migration 194 corrigiu isto no banco, e `sync-constants` trouxe. O texto antigo
    // dizia que o Alinhamento junta "faixas ideais de critério e consistência geral" — e o
    // cálculo (`netNameOverlap`) lê SÓ tags desde 27/06/2026. Como esta página deriva de
    // `ui_labels`, sem esta guarda um `sync-constants` sobre um banco não migrado traria a
    // frase errada de volta para uma quarta superfície, em silêncio.
    //
    // ⚠️ A asserção casa o FATO, não a palavra: o texto NOVO cita "critério" de propósito,
    // para dizer que ele não entra. Um `not.toMatch(/critério/)` reprovaria a correção e
    // aprovaria qualquer reescrita que trocasse a palavra mantendo a afirmação errada.
    const tip = LABELS.personal_fit.tooltip_full
    expect(tip, "o tooltip voltou a afirmar que o Alinhamento usa faixas de critério").not.toMatch(
      /faixas ideais de critério/i
    )
    expect(tip, "o tooltip voltou a afirmar que ele usa consistência geral").not.toMatch(
      /consistência geral/i
    )
    // e diz positivamente o que o cálculo faz
    expect(tip).toMatch(/tags/i)
    expect(tip, "o tooltip não diz mais que critério e gênero ficam de fora").toMatch(
      /não entram/i
    )
  })

  it("toda entrada do recálculo tem rótulo humano", () => {
    // `RECALC_INPUT_LABELS` é `Record<RecalcInput, string>`, então o `tsc` reprova entrada
    // nova sem rótulo. O que ele não vê é o rótulo vazio.
    for (const input of RECALC_INPUTS) {
      expect(RECALC_INPUT_LABELS[input]?.length ?? 0, `${input} sem rótulo`).toBeGreaterThan(3)
    }
  })

  it("nada na lista de exclusões entra de fato no recálculo", () => {
    // 🔴 A invariante que sustenta a seção "o que não entra". Ela é escrita à mão porque é
    // o complemento de um universo aberto — mas o dia em que alguém ligar `work_genres` ao
    // modelo, a página passaria a afirmar o contrário do que o cálculo faz. Aqui isso vira
    // falha.
    const dentro = new Set<string>(RECALC_INPUTS)
    for (const x of SCORE_EXCLUSIONS) {
      expect(dentro.has(x.slug), `${x.slug} está listado como "não entra" e ENTRA no recálculo`).toBe(
        false
      )
    }
    expect(SCORE_EXCLUSIONS.length).toBeGreaterThan(5)
  })

  it("as contagens pessoais não são servidas sem sessão", () => {
    // 🔴 `calculated_scores` não tem `user_id`: a Nota Prevista, o Alinhamento e o Veredito
    // que moram lá são do DONO. Uma página PÚBLICA que os conte publica o gosto dele com
    // cara de estatística — a mesma falha medida em /dashboard e /account/taste-profile.
    // A leitura tem que sair de `getSessionUserId`, nunca de `getCurrentUserId` (que cai no
    // singleton do dono por design).
    const src = readFileSync("server/queries/score-coverage.ts", "utf8")
    expect(src).toContain("getSessionUserId")
    expect(src, "getCurrentUserId cai no dono — aqui isso é vazamento").not.toContain(
      "getCurrentUserId"
    )
    // e o caminho sem sessão tem que sair ANTES de contar qualquer coisa pessoal
    const semSessao = src.indexOf("if (!sessionId)")
    const primeiraPessoal = src.indexOf("expected_score")
    expect(semSessao, "não há saída antecipada para o visitante").toBeGreaterThan(0)
    expect(
      semSessao < primeiraPessoal,
      "a contagem pessoal roda antes de checar a sessão"
    ).toBe(true)
  })

  it("nenhuma contagem traz linha do banco", () => {
    // O catálogo já passou de 1.000 obras: somar no cliente cairia no corte silencioso do
    // PostgREST e devolveria um número plausível e errado. Todo `select` daqui é count
    // exato com `head`.
    //
    // ⚠️ A varredura NÃO usa `/\.select\([^)]*\)/`: os embeds do PostgREST têm parêntese
    // dentro (`category_scores!inner(work_id)`), então esse regex corta a chamada no meio e
    // reprova um select correto. Aqui a janela é por posição — o objeto de opções vem logo
    // depois do primeiro argumento.
    const src = readFileSync("server/queries/score-coverage.ts", "utf8")
    const posicoes: number[] = []
    for (let i = src.indexOf(".select("); i !== -1; i = src.indexOf(".select(", i + 1)) {
      posicoes.push(i)
    }
    expect(posicoes.length, "a varredura não achou os selects").toBeGreaterThan(3)
    for (const i of posicoes) {
      const janela = src.slice(i, i + 220)
      expect(janela, `select sem count exato perto do offset ${i}`).toContain('count: "exact"')
      expect(janela, `select sem head perto do offset ${i}`).toContain("head: true")
    }
  })
})
