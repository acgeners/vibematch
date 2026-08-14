import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { UNREAD_PERSONAL_STATUSES } from "@/lib/constants/criteria"

/**
 * O botão "Todos" de cada dimensão de status é um INTERRUPTOR de dois estados: marca tudo, ou
 * volta ao padrão. Antes ele gravava `null` ao ser clicado já marcado — e em /favorites, onde
 * a ausência do parâmetro JÁ significa "sem filtro", o painel relia o mesmo estado e
 * redesenhava tudo marcado: o clique não fazia nada, e chegar a "só Completed" custava
 * desmarcar os outros quatro a dedo.
 */
const painel = readFileSync(
  join(process.cwd(), "components/ranking/ranking-filters.tsx"),
  "utf-8"
)

describe("'Todos' clicado já marcado volta ao padrão", () => {
  it("grava o padrão na URL — nunca `null`", () => {
    // `null` é o estado "ninguém escolheu", e em /favorites ele é lido como "all": o botão
    // levaria de volta ao lugar de onde saiu.
    expect(painel).toContain("pub_status: isAllPublication")
    expect(painel).toContain("BASELINE_PUBLICATION_STATUSES.join(\",\")")
    expect(painel).toContain("per_status: isAllPersonal")
    expect(painel).toContain("BASELINE_PERSONAL_STATUSES.join(\",\")")
    expect(painel).not.toMatch(/pub_status: isAllPublication \? null : "all"/)
    expect(painel).not.toMatch(/per_status: isAllPersonal \? null : "all"/)
  })

  it("o padrão é o MESMO que a página assume sem parâmetro — uma constante só", () => {
    // 🔴 Se o botão escrevesse a lista à mão, ele levaria a um estado que a página não
    // reconhece como padrão, e o "Todos" reacenderia no render seguinte.
    expect(painel).toContain("const BASELINE_PUBLICATION_STATUSES = [\"Completed\"] as const")
    expect(painel).toContain("const BASELINE_PERSONAL_STATUSES = UNREAD_PERSONAL_STATUSES")
    expect(painel).toContain(": [...BASELINE_PUBLICATION_STATUSES]")
    expect(painel).toContain(": [...BASELINE_PERSONAL_STATUSES]")
  })

  it("o padrão pessoal continua sendo Want to Read + Untracked", () => {
    expect([...UNREAD_PERSONAL_STATUSES]).toEqual(["Want to Read", "Untracked"])
  })

  it("os dois botões dizem para onde levam", () => {
    // O gesto é invisível sem isto: um badge marcado que ao ser clicado troca de estado
    // precisa anunciar o destino, senão a pessoa não descobre que ele desliga.
    expect(painel).toContain("Voltar ao padrão (${BASELINE_PUBLICATION_STATUSES.join(\", \")})")
    expect(painel).toContain("Voltar ao padrão (${BASELINE_PERSONAL_STATUSES.join(\", \")})")
  })

  it("continua zerando o par `_exclude` — os dois params, sempre", () => {
    // Só apagar o positivo deixaria a exclusão de pé por baixo de um badge que promete o
    // catálogo todo.
    expect(painel).toContain("pub_status_exclude: null")
    expect(painel).toContain("per_status_exclude: null")
  })
})
