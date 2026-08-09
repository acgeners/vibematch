import { describe, it, expect } from "vitest"

import {
  STATUS_FILTER_PARAMS,
  readStatusFilter,
  setStatusRule,
  toggleStatusParam,
} from "@/lib/status-filter-toggle"

const PUB = ["Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown"] as const
const DEFAULTS = ["Completed"] as const

/** Lê de um objeto simples, como a página faz com os searchParams. */
const from = (params: Record<string, string>) => (key: string) => params[key] ?? null

describe("readStatusFilter — inclusão × exclusão", () => {
  it("ausente cai nos defaults DA PÁGINA", () => {
    expect(readStatusFilter(from({}), "publication", DEFAULTS)).toEqual({ include: ["Completed"] })
    // /favorites não passa defaults: ausente é ausente, não "Completed".
    expect(readStatusFilter(from({}), "publication")).toEqual({})
  })

  it('"all" é sem restrição — nem include, nem exclude', () => {
    expect(readStatusFilter(from({ pub_status: "all" }), "publication", DEFAULTS)).toEqual({})
  })

  it("lista positiva vira include", () => {
    expect(readStatusFilter(from({ pub_status: "Ongoing,Hiatus" }), "publication", DEFAULTS)).toEqual({
      include: ["Ongoing", "Hiatus"],
    })
  })

  it("o parâmetro _exclude vira exclude", () => {
    expect(readStatusFilter(from({ pub_status_exclude: "Cancelled" }), "publication", DEFAULTS)).toEqual({
      exclude: ["Cancelled"],
    })
  })

  /**
   * 🔴 O caso que produz filtro que não filtra: uma URL montada à mão (ou um preset
   * salvo antes da feature) traz os dois. Sem uma regra, `getRanking` receberia
   * include E exclude e aplicaria os dois — devolvendo um resultado plausível que não
   * corresponde a nenhum dos dois modos que a UI sabe desenhar.
   */
  it("com os DOIS preenchidos, a exclusão vence e o positivo é ignorado", () => {
    const filter = readStatusFilter(
      from({ pub_status: "Completed,Ongoing", pub_status_exclude: "Cancelled" }),
      "publication",
      DEFAULTS
    )
    expect(filter).toEqual({ exclude: ["Cancelled"] })
    expect(filter.include).toBeUndefined()
  })

  it("cada dimensão lê o SEU par de parâmetros", () => {
    const params = { pub_status_exclude: "Cancelled", per_status: "Reading" }
    expect(readStatusFilter(from(params), "publication")).toEqual({ exclude: ["Cancelled"] })
    expect(readStatusFilter(from(params), "personal")).toEqual({ include: ["Reading"] })
  })
})

describe("setStatusRule — os dois lados nunca ficam ligados juntos", () => {
  const empty = { include: null, exclude: null }

  it("excluir escreve o _exclude e apaga o positivo", () => {
    expect(
      setStatusRule("publication", { include: "Completed,Ongoing", exclude: null }, "Cancelled", "exclude", PUB, DEFAULTS)
    ).toEqual({ pub_status: null, pub_status_exclude: "Cancelled" })
  })

  it("excluir acumula", () => {
    expect(
      setStatusRule("publication", { include: null, exclude: "Cancelled" }, "Hiatus", "exclude", PUB, DEFAULTS)
    ).toEqual({ pub_status: null, pub_status_exclude: "Cancelled,Hiatus" })
  })

  it("desfazer uma exclusão tira só ela; a última zera o parâmetro", () => {
    expect(
      setStatusRule("publication", { include: null, exclude: "Cancelled,Hiatus" }, "Hiatus", null, PUB, DEFAULTS)
    ).toEqual({ pub_status_exclude: "Cancelled" })
    expect(
      setStatusRule("publication", { include: null, exclude: "Cancelled" }, "Cancelled", null, PUB, DEFAULTS)
    ).toEqual({ pub_status_exclude: null })
  })

  /** Excluir tudo é "nenhuma obra": não é tela útil e nem é alcançável pelos positivos. */
  it("excluir a última opção restante volta a exclusão nenhuma", () => {
    const allButOne = PUB.slice(0, 4).join(",")
    expect(
      setStatusRule("publication", { include: null, exclude: allButOne }, "Unknown", "exclude", PUB, DEFAULTS)
    ).toEqual({ pub_status: null, pub_status_exclude: null })
  })

  /**
   * 🔴 O bug que este teste tranca: partindo do modo exclusão, incluir um status tem
   * que resultar NELE, sozinho. Materializar `"all"` antes do toggle fazia o clique em
   * "Ongoing" DESMARCAR Ongoing (o oposto do gesto); materializar os defaults da página
   * fazia "Completed" aparecer marcado junto, sem ninguém ter pedido.
   */
  it("sair do modo exclusão para incluir deixa SÓ o status clicado", () => {
    expect(
      setStatusRule("publication", { include: null, exclude: "Cancelled,Hiatus" }, "Ongoing", "include", PUB, DEFAULTS)
    ).toEqual({ pub_status: "Ongoing", pub_status_exclude: null })
  })

  it("sem exclusão ativa, incluir soma à seleção corrente", () => {
    expect(
      setStatusRule("publication", { include: "Completed", exclude: null }, "Ongoing", "include", PUB, DEFAULTS)
    ).toEqual({ pub_status: "Completed,Ongoing", pub_status_exclude: null })
  })

  it("selecionar TODAS as opções volta à forma canônica \"all\"", () => {
    expect(
      setStatusRule("publication", { include: PUB.slice(0, 4).join(","), exclude: null }, "Unknown", "include", PUB, DEFAULTS)
    ).toEqual({ pub_status: "all", pub_status_exclude: null })
  })

  it("desmarcar o último positivo também vira \"all\" (vazio = sem restrição)", () => {
    expect(
      setStatusRule("publication", { include: "Completed", exclude: null }, "Completed", null, PUB, DEFAULTS)
    ).toEqual({ pub_status: "all", pub_status_exclude: null })
  })

  it("escreve os DOIS parâmetros da dimensão, sempre que troca de modo", () => {
    const updates = setStatusRule("personal", empty, "Reading", "exclude", ["Reading", "Finished"], [])
    expect(Object.keys(updates).sort()).toEqual(["per_status", "per_status_exclude"])
  })
})

describe("o par de parâmetros é o mesmo em toda a base", () => {
  it("cada dimensão tem include e exclude declarados num lugar só", () => {
    expect(STATUS_FILTER_PARAMS.publication).toEqual({
      include: "pub_status",
      exclude: "pub_status_exclude",
    })
    expect(STATUS_FILTER_PARAMS.personal).toEqual({
      include: "per_status",
      exclude: "per_status_exclude",
    })
  })

  it("o toggle positivo antigo segue intacto (outros consumidores dependem dele)", () => {
    expect(toggleStatusParam("Completed", "Ongoing", PUB, DEFAULTS)).toBe("Completed,Ongoing")
    expect(toggleStatusParam("all", "Cancelled", PUB, DEFAULTS)).toBe("Completed,Ongoing,Hiatus,Unknown")
  })
})
