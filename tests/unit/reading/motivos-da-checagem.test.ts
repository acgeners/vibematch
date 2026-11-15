// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  checkOutcomeHeadline,
  describeCheckFailure,
  failureReasons,
  groupByReason,
  reasonLabel,
} from "@/lib/reading/check-failures"
import type { ChapterCheckFailure } from "@/lib/reading/check-failures"
import { MangagoUnavailableError } from "@/lib/external/mangago"

// O motivo de cada obra "não verificada" chega à tela (`CheckFailuresList`) e ao log
// (`[reading-check]`). A tela traduz o texto cru; motivo que o tradutor não reconhece aparece CRU.
// Os casos usam as mensagens que o código de verdade produz, inclusive a da classe de erro real do
// Mangago: se alguém mudar o texto de lá, a tradução deixa de casar e este teste acusa.

const URL_MG = "https://www.mangago.me/read-manga/obra_ficticia/"

describe("reasonLabel — motivo cru → rótulo legível", () => {
  it.each([
    ["[withTimeout] chapter:mangago excedeu 25000ms", "tempo esgotado (25 s)", "failed"],
    ["comix indisponível (rate_limited)", "limite de pedidos", "failed"],
    ["comix indisponível (blocked)", "bloqueado pelo site", "failed"],
    ["comix indisponível (bypass_unavailable)", "contorno do Cloudflare fora do ar", "failed"],
    ["comix indisponível (server_error)", "erro no site", "failed"],
    ["comix indisponível (fetch_failed)", "sem resposta", "failed"],
    ["comix indisponível (invalid_response)", "resposta inválida", "failed"],
    [new MangagoUnavailableError("blocked", URL_MG).message, "bloqueado pelo site", "failed"],
    [new MangagoUnavailableError("fetch_failed", URL_MG).message, "sem resposta", "failed"],
    [new MangagoUnavailableError("bypass_unavailable", URL_MG).message, "contorno do Cloudflare fora do ar", "failed"],
    [new MangagoUnavailableError("timeout", URL_MG).message, "tempo esgotado", "failed"],
    ["código hrj2k não existe (404)", "código hrj2k não existe (404)", "failed"],
    ["número descartado pela régua (815)", "número descartado (815)", "failed"],
    ["erro: falha ao gravar o código", "erro inesperado", "failed"],
    ["sem vínculo", "sem vínculo", "absent"],
    ["sem código, e a busca não achou", "sem código, e a busca não achou", "absent"],
    ["respondeu sem capítulo", "respondeu sem capítulo", "absent"],
    ["Comix marcada como ausente: checagem pulada (o Mangago também)", "marcada como ausente (checagem pulada)", "absent"],
  ])("%s → %s", (raw, label, tone) => {
    expect(reasonLabel(raw)).toEqual({ label, tone })
  })

  it("motivo desconhecido aparece CRU e vermelho, nunca escondido nem suavizado", () => {
    expect(reasonLabel("algo que ninguém previu")).toEqual({ label: "algo que ninguém previu", tone: "failed" })
  })
})

describe("failureReasons e describeCheckFailure — tela e log saem do mesmo objeto", () => {
  const porFonte: ChapterCheckFailure = {
    kind: "sources",
    sources: { comix: "comix indisponível (rate_limited)", mangago: "[withTimeout] chapter:mangago excedeu 25000ms" },
  }

  it("um motivo por fonte, na ordem das fontes de capítulo, com o texto cru para a dica", () => {
    expect(failureReasons(porFonte)).toEqual([
      { source: "Comix", label: "limite de pedidos", tone: "failed", raw: "comix indisponível (rate_limited)" },
      { source: "Mangago", label: "tempo esgotado (25 s)", tone: "failed", raw: "[withTimeout] chapter:mangago excedeu 25000ms" },
    ])
  })

  it("a linha do log é o texto cru, por fonte", () => {
    expect(describeCheckFailure(porFonte)).toBe(
      "comix: comix indisponível (rate_limited) · mangago: [withTimeout] chapter:mangago excedeu 25000ms",
    )
  })

  it("motivo da obra inteira: Comix ausente é da Comix; erro inesperado é da obra", () => {
    expect(failureReasons({ kind: "whole", reason: "Comix marcada como ausente: checagem pulada (o Mangago também)" })[0].source).toBe("Comix")
    expect(failureReasons({ kind: "whole", reason: "erro: x" })[0]).toMatchObject({ source: null, label: "erro inesperado" })
    expect(describeCheckFailure({ kind: "whole", reason: "erro: x" })).toBe("erro: x")
  })
})

describe("groupByReason — o resumo do topo da lista", () => {
  const T = (s: string) => `[withTimeout] chapter:${s} excedeu 25000ms`
  const items = [
    { failure: { kind: "sources" as const, sources: { comix: T("comix"), mangago: T("mangago") } } },
    { failure: { kind: "sources" as const, sources: { comix: T("comix"), mangago: T("mangago") } } },
    { failure: { kind: "sources" as const, sources: { comix: T("comix"), mangago: "sem vínculo" } } },
    { failure: { kind: "sources" as const, sources: { comix: "comix indisponível (rate_limited)", mangago: "sem vínculo" } } },
  ]

  it("conta as obras por motivo, do mais comum para o menos", () => {
    expect(groupByReason(items)).toEqual([
      { key: "Comix · tempo esgotado (25 s)", tone: "failed", count: 3 },
      { key: "Mangago · sem vínculo", tone: "absent", count: 2 },
      { key: "Mangago · tempo esgotado (25 s)", tone: "failed", count: 2 },
      { key: "Comix · limite de pedidos", tone: "failed", count: 1 },
    ])
  })
})

describe("checkOutcomeHeadline — 'nenhuma novidade' só sobre o que foi olhado", () => {
  it("o caso de 15/11: 53 de 55 não verificadas não é 'nenhuma novidade encontrada'", () => {
    expect(checkOutcomeHeadline({ total: 55, failed: 53, news: 0 })).toEqual({
      title: "Nenhuma novidade nas 2 obras verificadas",
      tone: "warning",
    })
  })

  it("nenhuma verificada é falha da checagem, não ausência de novidade", () => {
    expect(checkOutcomeHeadline({ total: 55, failed: 55, news: 0 })).toEqual({
      title: "Nenhuma obra foi verificada",
      tone: "error",
    })
    expect(checkOutcomeHeadline({ total: 1, failed: 1, news: 0 }).title).toBe("A obra não foi verificada")
  })

  it("uma só verificada usa o singular", () => {
    expect(checkOutcomeHeadline({ total: 3, failed: 2, news: 0 }).title).toBe("Nenhuma novidade na única obra verificada")
  })

  it("tudo verificado e nada novo segue verde", () => {
    expect(checkOutcomeHeadline({ total: 55, failed: 0, news: 0 })).toEqual({
      title: "Nenhuma novidade encontrada",
      tone: "success",
    })
  })

  it("com novidade, o título é a novidade (as falhas vão na descrição)", () => {
    expect(checkOutcomeHeadline({ total: 55, failed: 10, news: 2 })).toEqual({
      title: "2 obras com capítulo novo",
      tone: "success",
    })
    expect(checkOutcomeHeadline({ total: 5, failed: 0, news: 1 }).title).toBe("1 obra com capítulo novo")
  })
})
