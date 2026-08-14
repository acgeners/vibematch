import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, cleanup } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/lib/reading-view-preference", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  writeReadingViewCookie: vi.fn(),
}))

const checkReadingUpdates = vi.fn()
vi.mock("@/server/actions/reading", () => ({
  checkReadingUpdates: (...args: unknown[]) => checkReadingUpdates(...args),
}))
vi.mock("@/server/actions/works", () => ({
  setChaptersRead: vi.fn(),
  setReadingStatusForWorks: vi.fn(),
  archiveWork: vi.fn(),
}))

import { dismissTask, readTasks } from "@/lib/tasks-store"
import { ReadingList } from "@/components/reading/reading-list"
import type { ReadingWork } from "@/server/queries/reading"

const base = {
  publicationStatusId: 1,
  coverUrl: "https://example.test/capa.jpg",
  lastReadAt: "2026-08-05T12:00:00.000Z",
  lastChapterReleasedAt: "2026-08-07T12:00:00.000Z",
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  isAdult: false,
} as unknown as ReadingWork

// 8 obras: mais que uma fatia (`CHECK_CHUNK = 6`), pra o contador ter o que contar.
const WORKS: ReadingWork[] = Array.from({ length: 8 }, (_, i) => ({
  ...base,
  id: `w${i + 1}`,
  title: `Obra ${i + 1}`,
  chaptersRead: 10,
  totalChapters: 11,
}))

/** Promise com gatilho externo — pra congelar a tarefa no meio e olhar o contador. */
function comControle() {
  let solta!: (v: unknown) => void
  const promise = new Promise((r) => {
    solta = r
  })
  return { promise, solta }
}

const semNovidade = (ids: string[]) =>
  ids.map((id) => ({ workId: id, hasNew: false, latestExternal: 11 }))

/**
 * "Verificar atualizações" GRAVA no banco enquanto roda (total de capítulos, status de
 * publicação, datas) — logo é tarefa DURÁVEL, e o lugar dela é o indicador AZUL, com
 * contador. Isto é teste de RENDER porque o que regride aqui é a LIGAÇÃO: um
 * `useTransition` local continua "funcionando" (o botão gira, a ação roda), só que o
 * feedback morre na primeira navegação — numa ação de ~40s, que é o caso todo.
 */
describe("/leitura: a checagem de capítulos é tarefa durável (azul) com contador", () => {
  beforeEach(() => {
    checkReadingUpdates.mockReset()
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
  })

  it("registra tarefa no store com contador que ANDA a cada fatia", async () => {
    const fatia1 = comControle()
    const fatia2 = comControle()
    const chunksPedidos: string[][] = []
    checkReadingUpdates
      .mockImplementationOnce((ids: string[]) => {
        chunksPedidos.push(ids)
        return fatia1.promise
      })
      .mockImplementationOnce((ids: string[]) => {
        chunksPedidos.push(ids)
        return fatia2.promise
      })

    const { getByText } = render(
      <ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />,
    )
    await act(async () => {
      getByText("Verificar atualizações").click()
      await Promise.resolve()
    })

    const tarefa = readTasks().find((t) => t.id === "reading-check")
    expect(tarefa).toBeTruthy()
    expect(tarefa!.status).toBe("running")
    // Barra DETERMINADA: sem `progress` o card cai na indeterminada e o "0/8" some.
    expect(tarefa!.progress).toEqual({ done: 0, total: WORKS.length })
    // A checagem vai em FATIAS — mandar as 8 de uma vez é o que não deixa contar nada.
    expect(chunksPedidos[0]!.length).toBeLessThan(WORKS.length)

    await act(async () => {
      fatia1.solta(semNovidade(chunksPedidos[0]!))
      await Promise.resolve()
      await Promise.resolve()
    })

    const meio = readTasks().find((t) => t.id === "reading-check")
    expect(meio!.status).toBe("running")
    expect(meio!.progress!.done).toBe(chunksPedidos[0]!.length)
    expect(meio!.progress!.total).toBe(WORKS.length)

    await act(async () => {
      fatia2.solta(semNovidade(chunksPedidos[1]!))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(readTasks().find((t) => t.id === "reading-check")!.status).toBe("done")
  })

  it("action que devolve [] (gate recusou) vira ERRO, não 'pronto'", async () => {
    // 🔴 `checkReadingUpdates` não lança quando o gate de admin recusa — devolve `[]`.
    // Sem conversão explícita, o indicador anunciaria conclusão de uma checagem que
    // nunca aconteceu: plausível, errado, e sem nada no console.
    checkReadingUpdates.mockResolvedValue([])

    const { getByText } = render(
      <ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />,
    )
    await act(async () => {
      getByText("Verificar atualizações").click()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    const tarefa = readTasks().find((t) => t.id === "reading-check")
    expect(tarefa!.status).toBe("error")
  })
})
