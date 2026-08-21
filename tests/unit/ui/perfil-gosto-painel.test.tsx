import { vi, describe, it, expect, afterEach } from "vitest"

// "use server" / server-only não rodam no ambiente de teste.
vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/recommendations", () => ({ generateTasteProfileAction: vi.fn() }))
vi.mock("@/lib/tasks-store", () => ({ runTask: vi.fn() }))
vi.mock("@/components/tasks/use-app-tasks", () => ({ useAppTasks: () => [] }))

import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { TasteProfilePanel } from "@/components/account/taste-profile-panel"
import type { ProfileStatus } from "@/server/actions/recommendations"
import type { AlignedWork, AlignedWorkSplit } from "@/server/queries/recommendations"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"
import type { DeclaredTagLite } from "@/lib/ai-recommendation/profile-tag-origin"

/**
 * O painel da /account/taste-profile, em RENDER — de propósito.
 *
 * O que regride nesta classe é ESCOPO, e escopo não aparece em função pura. Os três
 * defeitos que motivaram a v3 passariam verdes num teste que lesse o objeto do perfil:
 * a `note` de cada critério existia no banco e não ia pra tela; tema e tag saíam com a
 * MESMA forma; e o mesmo número de correlação era impresso duas vezes com dois
 * rótulos. Todos invisíveis fora da árvore desenhada.
 */

afterEach(cleanup)

const ISO = "2026-07-30T07:51:55.000Z"

const PROFILE: TasteProfileRow = {
  id: "p1",
  version: 23,
  is_current: true,
  is_stub: false,
  n_works_used: 200,
  input_hash: "h",
  model_name: "claude-sonnet-5",
  prompt_version: "v7",
  created_at: ISO,
  raw_response: null,
  heuristic_fingerprint: null,
  profile: {
    loved_tags: [
      { name: "Villainess", group: "character_context", strength: 0.9 },
      { name: "Isekai", group: "setting", strength: 0.75 },
    ],
    avoided_tags: [{ name: "Harem", group: "romance", strength: 0.5 }],
    loved_themes: ["Vilãs tentando escapar do destino trágico"],
    avoided_themes: ["Comédia ecchi escolar com harém sem profundidade emocional"],
    criterion_preferences: {
      romance: {
        ideal_min: 7,
        ideal_max: 9.5,
        weight: 0.9,
        note: "Romance é o pilar central; funciona melhor com slow-burn.",
      },
      humor: { ideal_min: 4, ideal_max: 8.5, weight: 0.5, note: "Humor leve, não decisivo." },
    },
    narrative_patterns: ["FL reencarna como vilã"],
    summary: "Resumo longo do gosto.",
    short_summary: "Resumo curto do gosto.",
  },
}

const STATUS: ProfileStatus = {
  hasProfile: true,
  profile: PROFILE,
  isStale: false,
  currentHash: "h",
  ratedWorksCount: 200,
  staleness: {
    stale: false,
    reason: "identical",
    driftPct: 0.063,
    changedTags: 2,
    lovedJaccard: 0.9,
    avoidedJaccard: 1,
    fractionNew: 0,
    ageDays: 9,
  },
  regenCostUsd: 0.4,
}

const work = (
  n: number,
  expected: number,
  user: number | null,
  over?: Partial<AlignedWork>,
): AlignedWork => ({
  id: `w${n}`,
  title: `Obra ${n}`,
  coverUrls: [],
  isAdult: false,
  personalFit: 0.5,
  personalFitPercentile: 90,
  personalStatus: user == null ? "Want to Read" : "Finished",
  chaptersRead: user == null ? 0 : 100,
  totalChapters: 100,
  userScore: user,
  expectedScore: expected,
  // 2 = Ongoing, 3 = Hiatus (PUBLICATION_STATUSES_BY_ID)
  publicationStatusId: 2,
  chanceScore: 62,
  ...over,
})

const ALIGNED: AlignedWorkSplit = {
  read: [work(1, 9.1, 9.4), work(2, 8.7, 8.3)],
  unread: [work(11, 8.7, null), work(12, 8.6, null), work(13, 8.5, null), work(14, 8.4, null)],
  readTotal: 105,
  unreadTotal: 728,
  otherTotal: 137,
  confirmation: {
    ratedRead: 104,
    topAvgScore: 8.7,
    overallAvgScore: 7.8,
    topN: 20,
    topHighCount: 17,
    highScoreThreshold: 8,
    correlation: 0.77,
  },
}

const DECLARED: DeclaredTagLite[] = [
  { name: "Villainess", stance: "love", source: "tag" },
  { name: "Harem", stance: "avoid", source: "tag" },
  { name: "Revenge", stance: "love", source: "tag" },
]

function renderPanel(over?: Partial<Parameters<typeof TasteProfilePanel>[0]>) {
  return render(
    <TasteProfilePanel
      status={STATUS}
      aligned={ALIGNED}
      drivers={[]}
      declared={DECLARED}
      unreadPageSize={2}
      {...over}
    />,
  )
}

const goTo = (label: RegExp) => fireEvent.click(screen.getByRole("tab", { name: label }))

/** A célula de uma das duas provas do hero, a partir do rótulo dela. */
const proofCell = (label: RegExp) => screen.getByText(label).closest("div") as HTMLElement

describe("hero: as duas provas", () => {
  it("imprime a correlação UMA vez só", () => {
    // 🔴 Na v2 o mesmo `confirmation.correlation` saía no medidor do hero ("o perfil te
    // representa") e de novo 2.900px abaixo ("obras compatíveis tendem a receber suas
    // notas mais altas") — dois rótulos para um número, lidos como duas métricas.
    renderPanel()
    expect(screen.getAllByText("77%")).toHaveLength(1)
  })

  it("mostra concordância e correlação com rótulos DIFERENTES", () => {
    renderPanel()
    // 2 tags declaradas casam (Villainess/love, Harem/avoid); Isekai é descoberta.
    const acordo = within(proofCell(/A IA chegou sozinha/i))
    expect(acordo.getByText("2")).toBeTruthy()
    expect(acordo.getByText(/de 2/)).toBeTruthy()
    expect(acordo.getByText(/Outras 1 ela descobriu sozinha/)).toBeTruthy()
  })

  it("as 3 parcelas da confirmação moram JUNTO do 77%, não numa seção distante", () => {
    renderPanel()
    // Escopado ao bloco: "8,7" também é a Nota Prevista de uma capa da trilha — e é
    // exatamente por isso que a v2 confundia, com as parcelas a 2.900px do número.
    const corr = within(proofCell(/E isso aparece nas suas notas/i))
    expect(corr.getByText("77%")).toBeTruthy()
    expect(corr.getByText("8,7")).toBeTruthy()
    expect(corr.getByText("7,8")).toBeTruthy()
    expect(corr.getByText(/de 20/)).toBeTruthy()
  })

  it("oferece caminho pra discordar do que a página afirma", () => {
    renderPanel()
    const link = screen.getByRole("link", { name: /corrigir em Prefer/i })
    expect(link.getAttribute("href")).toBe("/preferences")
  })

  it("carrega o selo de procedência de IA", () => {
    // Régua do CLAUDE.md: bloco gerado por modelo leva o selo. A página inteira é
    // saída de LLM e a v2 não tinha nenhum.
    renderPanel()
    expect(screen.getAllByRole("button", { name: /ver modelo e data/i }).length).toBeGreaterThan(0)
  })
})

describe("aba Seus critérios", () => {
  it("🔴 mostra a frase que a IA escreveu sobre o critério", () => {
    // O campo `note` existe em 9 de 9 critérios no banco e a v2 não exibia NENHUM.
    renderPanel()
    goTo(/Seus critérios/)
    expect(screen.queryByText(/Romance é o pilar central/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Romance/ }))
    expect(screen.getByText(/Romance é o pilar central/)).toBeTruthy()
  })

  it("rotula FAIXA e PESO como campos separados", () => {
    // Na v2 a barra desenhava a faixa ideal e o "%" ao lado era o peso, sem nada
    // dizendo que eram grandezas diferentes: em Humor a barra é larga (4–8,5) com
    // peso 50%, e em Romance é estreita (7–9,5) com 90% — "barra maior = número
    // maior" se invertia.
    renderPanel()
    goTo(/Seus critérios/)
    expect(screen.getByText("7–9,5")).toBeTruthy()
    expect(screen.getByText("90%")).toBeTruthy()
    expect(screen.getByText("4–8,5")).toBeTruthy()
    expect(screen.getByText("50%")).toBeTruthy()
  })

  it("o critério aberto CONTINUA aberto ao voltar de outra aba", () => {
    // Os painéis desmontam na troca de aba; estado dentro deles zeraria a cada ida e
    // volta, e a pessoa reabriria tudo de novo sem entender por quê.
    renderPanel()
    goTo(/Seus critérios/)
    fireEvent.click(screen.getByRole("button", { name: /Romance/ }))
    goTo(/A prova/)
    goTo(/Seus critérios/)
    expect(screen.getByText(/Romance é o pilar central/)).toBeTruthy()
  })
})

describe("aba Tags e temas", () => {
  it("🔴 tema e tag têm FORMAS diferentes, não só cores", () => {
    // Tema não existe no catálogo, não casa com obra nenhuma e não entra no
    // `personal_fit` — sair com a mesma pílula da tag afirma que pesam igual. Um
    // teste que lesse o objeto do perfil passaria verde com os dois idênticos.
    renderPanel()
    goTo(/Tags e temas/)
    const tags = screen.getAllByTitle(/força no perfil/i)
    const tema = screen.getByText(/Vilãs tentando escapar/).closest("p")!
    // Toda tag é pílula; nenhum tema é.
    for (const tag of tags) expect(tag.className).toMatch(/rounded-full/)
    expect(tema.className).not.toMatch(/rounded-full/)
  })

  it("agrupa por ORIGEM, e a descoberta não vira concordância", () => {
    renderPanel()
    goTo(/Tags e temas/)
    const confirmado = screen.getByText(/Você declarou, e a IA confirmou/).closest("div")!
    expect(within(confirmado.parentElement!).getByText("Villainess")).toBeTruthy()
    const descoberto = screen.getByText(/A IA descobriu sozinha/).closest("div")!
    expect(within(descoberto.parentElement!).getByText("Isekai")).toBeTruthy()
  })

  it("mostra o balde de conflito quando os dois lados discordam", () => {
    // Sem ele, uma discordância real seria contada como acerto ou sumiria da tela.
    renderPanel({ declared: [{ name: "Villainess", stance: "avoid", source: "tag" }] })
    goTo(/Tags e temas/)
    expect(screen.getByText(/Vocês discordam/)).toBeTruthy()
  })

  it("diz que declarada fora do destilado NÃO é falha", () => {
    renderPanel()
    goTo(/Tags e temas/)
    expect(screen.getByText(/não entrou no destilado/i)).toBeTruthy()
  })
})

describe("aba O que isso muda", () => {
  it("🔴 o card da fila mostra ESTADO, afinidade e chance — cada um rotulado", () => {
    // A fila responde "o que leio agora?", e o estado é o dado que decide se vale COMEÇAR:
    // entre as 60 obras de maior Nota Prevista do catálogo, 12 (20%) estão em hiato ou
    // canceladas. Afinidade e chance são dois "%" vizinhos falando de gosto — sem rótulo,
    // leem como a mesma medida em desacordo.
    renderPanel({
      aligned: {
        ...ALIGNED,
        unread: [work(11, 8.7, null, { publicationStatusId: 3, personalFitPercentile: 94 })],
      },
    })
    goTo(/O que isso muda/)
    const card = screen.getByText("Obra 11").closest("li")!
    expect(within(card).getByText("afinidade")).toBeTruthy()
    expect(within(card).getByText("94%")).toBeTruthy()
    expect(within(card).getByText("chance")).toBeTruthy()
    expect(within(card).getByText("62%")).toBeTruthy()
    // 3 = Hiatus, e o selo é o do app (modo compacto ⇒ o código curto do banco)
    expect(within(card).getByText("HIA")).toBeTruthy()
  })

  it("chance vazia não vira número: sem previsão de verdade, sai '—'", () => {
    // `chance_is_stub` já chega como null da query — com menos de 20 obras avaliadas o
    // valor seria a média do treino com cara de previsão.
    renderPanel({
      aligned: { ...ALIGNED, unread: [work(11, 8.7, null, { chanceScore: null })] },
    })
    goTo(/O que isso muda/)
    const card = screen.getByText("Obra 11").closest("li")!
    expect(within(card).getByText("chance")).toBeTruthy()
    // pelo título, não pelo texto: "—" também é o vazio de outras células
    expect(within(card).getByTitle(/probabilidade de você gostar/i).textContent).toBe("—")
    // e a afinidade, que TEM valor, segue impressa — o vazio é só da chance
    expect(within(card).getByTitle(/casa com seu perfil/i).textContent).toBe("90%")
  })

  it("🔴 driver SEM explicação não ganha o pontilhado que anuncia o tooltip", () => {
    // O `resolveFeatureDescription` devolve null pra feature que ninguém previu, e a UI
    // tem que respeitar isso: um gatilho que abre vazio é pior do que uma linha muda.
    renderPanel({
      drivers: [
        { name: "SinopseScore", label: "Interesse na obra", description: "O quanto…", coef: 1 },
        { name: "FeatureNova", label: "FeatureNova", description: null, coef: 0.5 },
      ],
    })
    goTo(/O que isso muda/)
    const comTexto = screen.getByText("Interesse na obra")
    const semTexto = screen.getByText("FeatureNova")
    expect(comTexto.className).toContain("decoration-dotted")
    expect(semTexto.className).not.toContain("decoration-dotted")
  })

  it("pagina as próximas leituras e o rank continua entre páginas", () => {
    renderPanel()
    goTo(/O que isso muda/)
    expect(screen.getByText("Obra 11")).toBeTruthy()
    expect(screen.queryByText("Obra 13")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Próxima página/i }))
    const card = screen.getByText("Obra 13").closest("li")!
    // O rank CONTINUA (3º item), não reinicia em 1 a cada página.
    expect(within(card).getByText("3")).toBeTruthy()
  })

  it("a página da trilha SEGURA ao trocar de aba", () => {
    renderPanel()
    goTo(/O que isso muda/)
    fireEvent.click(screen.getByRole("button", { name: /Próxima página/i }))
    goTo(/A prova/)
    goTo(/O que isso muda/)
    expect(screen.getByText("Obra 13")).toBeTruthy()
  })
})

describe("aba A prova", () => {
  it("mostra PREVISTA e SUA NOTA lado a lado, cada uma rotulada", () => {
    // Mostrar só a nota da pessoa (v2) desperdiçava a única comparação que a página
    // tem pra provar acerto obra a obra.
    renderPanel()
    const card = screen.getByText("Obra 1").closest("li")!
    expect(within(card).getByText("prevista")).toBeTruthy()
    expect(within(card).getByText("sua nota")).toBeTruthy()
    expect(within(card).getByText("9,1")).toBeTruthy()
    expect(within(card).getByText("9,4")).toBeTruthy()
  })

  it("marca o erro do modelo em cada obra", () => {
    renderPanel()
    const card = screen.getByText("Obra 1").closest("li")!
    expect(within(card).getByTitle(/erro do modelo/i).textContent).toContain("0,3")
  })

  it("🔴 o rodapé do card é a PRECISÃO do modelo, não o alinhamento da obra", () => {
    // Numa lista de obras JÁ LIDAS ordenada pela Nota Prevista, o alinhamento é quase
    // constante (5 dos 6 cards reais marcavam ≥97%) e a pergunta da seção é outra: o
    // quanto o MODELO acerta. O alinhamento continua na trilha de NÃO-lidas, onde ele
    // de fato decide o que ler.
    renderPanel()
    const card = screen.getByText("Obra 1").closest("li")!
    // erro 0,3 na escala de 0–10 ⇒ 97%
    expect(within(card).getByText("97%")).toBeTruthy()
    // o percentil de alinhamento da fixture é 90 — não pode sobrar na tira
    expect(within(card).queryByText("90%")).toBeNull()
  })

  it("🔴 capítulos lidos ficam na CAPA, longe de qualquer barra ou porcentagem", () => {
    // Na versão anterior "215/228" ficava colado numa barra de alinhamento em 99% e
    // era lido como progresso de leitura — batia por acaso em 4 dos 6 cards reais.
    renderPanel()
    const card = screen.getByText("Obra 1").closest("li")!
    const chapters = within(card).getByTitle(/capítulos lidos/i)
    expect(chapters.textContent).toBe("100/100")
    // é sobreposição (mora na capa), não item da tira
    expect(chapters.className).toContain("absolute")
    // e o invariante que interessa: a tira de números não hospeda capítulos
    const strip = within(card).getByText("97%").closest("div")!
    expect(within(strip).queryByTitle(/capítulos lidos/i)).toBeNull()
  })

  it("acerto exato não ganha sinal — '+0' apareceu na tela", () => {
    // Visto no app rodando: obra com 8,6 previsto e 8,6 dado saía "+0", que afirma
    // uma direção que a diferença não tem. E o erro cravado em 1 ponto saía "1",
    // fora da coluna de uma casa que os outros cards formam.
    renderPanel({
      aligned: { ...ALIGNED, read: [work(1, 8.6, 8.6), work(2, 7.5, 8.5)] },
    })
    const exato = screen.getByText("Obra 1").closest("li")!
    expect(within(exato).getByTitle(/erro do modelo/i).textContent).toBe("0,0")
    expect(within(exato).getByText("100%")).toBeTruthy()

    const cravado = screen.getByText("Obra 2").closest("li")!
    expect(within(cravado).getByTitle(/erro do modelo/i).textContent).toBe("+1,0")
    expect(within(cravado).getByText("90%")).toBeTruthy()
  })

  it("as abas são um controle segmentado, e a ativa continua anunciada", () => {
    // O sublinhado de 2px sumia entre o hero e os cards. Trocar por trilho segmentado
    // não pode custar a semântica: os testes acima navegam por getByRole("tab").
    renderPanel()
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(4)
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1)
    goTo(/Tags e temas/)
    expect(screen.getByRole("tab", { name: /Tags e temas/ }).getAttribute("aria-selected")).toBe(
      "true",
    )
  })
})

describe("selo 18+ nas duas trilhas", () => {
  // O painel mostra capa e NOME de obra em duas trilhas (a prova, com as lidas, e a
  // fila das não lidas) e não dizia a classificação em nenhuma das duas — o dado nem
  // chegava aqui: `AlignedWork` não tinha `isAdult`. Render, não leitura do objeto:
  // um teste sobre o dado passaria verde com o selo fora da árvore.
  it("marca a obra 18+ na trilha das lidas, e só ela", () => {
    renderPanel({
      aligned: { ...ALIGNED, read: [work(1, 9.1, 9.4, { isAdult: true }), work(2, 8.7, 8.3)] },
    })
    const adulta = screen.getByText("Obra 1").closest("li")!
    const comum = screen.getByText("Obra 2").closest("li")!
    expect(within(adulta).getByTitle("Conteúdo adulto (18+)").textContent).toContain("18+")
    expect(within(comum).queryByTitle("Conteúdo adulto (18+)")).toBeNull()
  })

  it("marca também na fila das não lidas", () => {
    renderPanel({
      aligned: { ...ALIGNED, unread: [work(11, 8.7, null, { isAdult: true }), work(12, 8.6, null)] },
    })
    goTo(/O que isso muda/)
    const adulta = screen.getByText("Obra 11").closest("li")!
    expect(within(adulta).getByTitle("Conteúdo adulto (18+)")).toBeTruthy()
    expect(within(screen.getByText("Obra 12").closest("li")!).queryByTitle("Conteúdo adulto (18+)")).toBeNull()
  })
})
