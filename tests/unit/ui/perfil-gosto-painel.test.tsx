import { vi, describe, it, expect, afterEach } from "vitest"

// "use server" / server-only não rodam no ambiente de teste.
vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/recommendations", () => ({ generateTasteProfileAction: vi.fn() }))
vi.mock("@/lib/tasks-store", () => ({ runTask: vi.fn() }))
vi.mock("@/components/tasks/use-app-tasks", () => ({ useAppTasks: () => [] }))

import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { TasteProfilePanel } from "@/components/conta/taste-profile-panel"
import type { ProfileStatus } from "@/server/actions/recommendations"
import type { AlignedWork, AlignedWorkSplit } from "@/server/queries/recommendations"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"
import type { DeclaredTagLite } from "@/lib/ai-recommendation/profile-tag-origin"

/**
 * O painel da /conta/perfil, em RENDER — de propósito.
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

const work = (n: number, expected: number, user: number | null): AlignedWork => ({
  id: `w${n}`,
  title: `Obra ${n}`,
  coverUrl: null,
  personalFit: 0.5,
  personalFitPercentile: 90,
  personalStatus: user == null ? "Want to Read" : "Finished",
  chaptersRead: user == null ? 0 : 100,
  totalChapters: 100,
  userScore: user,
  expectedScore: expected,
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
    expect(link.getAttribute("href")).toBe("/preferencias")
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
})
