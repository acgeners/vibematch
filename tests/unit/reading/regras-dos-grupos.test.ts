import { describe, it, expect } from "vitest"
import {
  NEAR_CHAPTERS,
  SILENT_RELEASE_DAYS,
  STALE_DAYS,
  STALLED_DAYS,
  classifyCompleted,
  classifyOngoing,
  classifyPace,
  recencyDate,
} from "@/lib/reading/pace-bands"
import type { PaceInput } from "@/lib/reading/pace-bands"
import { withReadDateStamp } from "@/lib/reading/read-stamp"

const NOW = new Date("2026-11-02T12:00:00Z")
const diasAtras = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()

const obra = (lidos: number, total: number, over: Partial<PaceInput> = {}): PaceInput => ({
  chaptersRead: lidos,
  totalChapters: total,
  pending: Math.max(0, total - lidos),
  lastReadAt: diasAtras(3),
  publicationHiatus: false,
  ...over,
})

describe("Em andamento: capítulos que faltam × quando leu", () => {
  it("o exemplo da Ana: 3 capítulos, 2 lidos, é Acompanhando", () => {
    expect(classifyOngoing(obra(2, 3), NOW)).toBe("onpace")
    expect(classifyOngoing(obra(1, 3), NOW)).toBe("onpace")
  })

  it("a porcentagem não decide mais: 255 de 300 lidos (85%) está longe", () => {
    expect(classifyOngoing(obra(255, 300), NOW)).toBe("catching")
  })

  it("a matriz inteira, nas fronteiras", () => {
    const perto = NEAR_CHAPTERS
    expect(classifyOngoing(obra(10 - perto, 10), NOW)).toBe("onpace")
    expect(classifyOngoing(obra(10 - perto, 10, { lastReadAt: diasAtras(STALE_DAYS) }), NOW)).toBe("slowing")
    expect(classifyOngoing(obra(10 - perto, 10, { lastReadAt: diasAtras(STALE_DAYS - 1) }), NOW)).toBe("onpace")
    expect(classifyOngoing(obra(20 - perto - 1, 20), NOW)).toBe("catching")
    expect(classifyOngoing(obra(20 - perto - 1, 20, { lastReadAt: diasAtras(STALE_DAYS) }), NOW)).toBe("behind")
  })

  it("leu tudo é Em dia, por mais tempo que tenha passado desde a leitura", () => {
    expect(classifyOngoing(obra(40, 40, { lastReadAt: diasAtras(200) }), NOW)).toBe("uptodate")
    expect(classifyOngoing(obra(40, 40, { lastReadAt: null }), NOW)).toBe("uptodate")
  })

  it("sem total conhecido não dá pra medir distância: fica neutro", () => {
    expect(classifyOngoing(obra(5, 0, { totalChapters: null, pending: null }), NOW)).toBe("onpace")
  })

  it("hiato oficial na frente de tudo (é o que a home pergunta)", () => {
    expect(classifyPace(obra(2, 3, { publicationHiatus: true, hiatusKind: "between_seasons" }), NOW)).toBe("season_break")
    expect(classifyPace(obra(2, 3, { publicationHiatus: true, hiatusKind: "mid_season" }), NOW)).toBe("interrupted")
    expect(classifyPace(obra(2, 3, { publicationHiatus: true }), NOW)).toBe("hiatus")
  })
})

// Decidido em 2026-11-09: obra em andamento sem lançamento há 45+ dias está em hiato NA PRÁTICA,
// anunciado ou não, e vai para "Em hiato" — com ou sem capítulos por ler.
describe("hiato na prática", () => {
  const emAndamento = (lidos: number, total: number, diasSemLancar: number | null) =>
    obra(lidos, total, {
      publicationOngoing: true,
      lastReleasedAt: diasSemLancar == null ? null : diasAtras(diasSemLancar),
    })

  it("leu tudo e a obra não lança há 45 dias: Em hiato (era 'Sem capítulo novo')", () => {
    expect(classifyPace(emAndamento(40, 40, SILENT_RELEASE_DAYS), NOW)).toBe("hiatus")
    expect(classifyPace(emAndamento(40, 40, SILENT_RELEASE_DAYS - 1), NOW)).toBe("uptodate")
  })

  it("com capítulos por ler também: o hiato é da publicação, não da leitura", () => {
    expect(classifyPace(emAndamento(28, 30, 120), NOW)).toBe("hiatus")
    expect(classifyPace(emAndamento(10, 30, 120), NOW)).toBe("hiatus")
  })

  it("obra CONCLUÍDA não lança há meses e isso não é hiato", () => {
    const concluida = obra(28, 30, { publicationOngoing: false, lastReleasedAt: diasAtras(300) })
    expect(classifyPace(concluida, NOW)).toBe("onpace")
  })

  it("sem data de lançamento, nunca", () => {
    expect(classifyPace(emAndamento(40, 40, null), NOW)).toBe("uptodate")
  })

  it("o grupo de leitura nunca mais devolve 'Sem capítulo novo'", () => {
    const lancou = obra(40, 40, { publicationOngoing: true, lastReleasedAt: diasAtras(200) })
    expect(classifyOngoing(lancou, NOW)).toBe("uptodate")
  })
})

describe("obras sem data de leitura", () => {
  it("usam a última alteração para medir se está lendo", () => {
    const semData = (dias: number) => obra(28, 30, { lastReadAt: null, lastTouchedAt: diasAtras(dias) })
    expect(classifyOngoing(semData(5), NOW)).toBe("onpace")
    expect(classifyOngoing(semData(60), NOW)).toBe("slowing")
  })

  it("sem data nenhuma continuam contando como paradas", () => {
    expect(classifyOngoing(obra(28, 30, { lastReadAt: null }), NOW)).toBe("slowing")
  })

  it("a data de leitura vence a de alteração", () => {
    expect(recencyDate({ lastReadAt: "2026-01-01", lastTouchedAt: "2026-10-30" })).toBe("2026-01-01")
    expect(classifyOngoing(obra(28, 30, { lastReadAt: diasAtras(60), lastTouchedAt: diasAtras(1) }), NOW)).toBe("slowing")
  })
})

describe("Concluídas: vou terminar?", () => {
  it("leu tudo, quase no fim, e longe", () => {
    expect(classifyCompleted(obra(27, 27, { lastReadAt: null }), NOW)).toBe("finish")
    expect(classifyCompleted(obra(2, 5, { lastReadAt: diasAtras(300) }), NOW)).toBe("near")
    expect(classifyCompleted(obra(60, 100), NOW)).toBe("continuar")
    expect(classifyCompleted(obra(40, 100), NOW)).toBe("definir")
    expect(classifyCompleted(obra(60, 100, { lastReadAt: diasAtras(STALLED_DAYS) }), NOW)).toBe("parado")
  })

  it("sem total conhecido, decide pela recência", () => {
    const semTotal = { totalChapters: null, pending: null }
    expect(classifyCompleted(obra(5, 0, { ...semTotal, lastReadAt: diasAtras(100) }), NOW)).toBe("parado")
    expect(classifyCompleted(obra(5, 0, { ...semTotal }), NOW)).toBe("definir")
  })
})

describe("quando gravar a data de leitura", () => {
  const HOJE = "2026-11-02"
  it("capítulos que crescem carimbam hoje", () => {
    expect(withReadDateStamp({ chapters_read: 5 }, null, HOJE)).toEqual({ chapters_read: 5, last_read_at: HOJE })
    expect(withReadDateStamp({ chapters_read: 6 }, 5, HOJE)).toEqual({ chapters_read: 6, last_read_at: HOJE })
  })

  it("corrigir para baixo, repetir o número ou zerar não mexe na data", () => {
    expect(withReadDateStamp({ chapters_read: 4 }, 5, HOJE)).toEqual({ chapters_read: 4 })
    expect(withReadDateStamp({ chapters_read: 5 }, 5, HOJE)).toEqual({ chapters_read: 5 })
    expect(withReadDateStamp({ chapters_read: 0 }, null, HOJE)).toEqual({ chapters_read: 0 })
    expect(withReadDateStamp({ chapters_read: null }, null, HOJE)).toEqual({ chapters_read: null })
  })

  it("nunca por cima de uma data que veio no próprio patch", () => {
    expect(withReadDateStamp({ chapters_read: 9, last_read_at: "2026-10-01" }, 1, HOJE).last_read_at).toBe("2026-10-01")
    expect(withReadDateStamp({ chapters_read: 9, last_read_at: null }, 1, HOJE).last_read_at).toBeNull()
  })
})
