import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"

/**
 * O texto do prompt fica ATRELADO à `PROMPT_VERSION`, que entra na chave de cache
 * (`canonicalInputHash`) e é gravada em `ai_evaluations.prompt_version`.
 *
 * Sem esta trava, editar o prompt sem trocar a versão faz duas coisas silenciosas:
 * o cache serve avaliações da régua ANTIGA como se fossem da nova, e o rótulo no
 * banco mente sobre qual rubrica produziu cada nota. Medido em 2026-08-09: as notas
 * VIGENTES do catálogo vêm de 9 versões diferentes (a corrente cobria 9,4% das obras),
 * e a amplitude entre reavaliações da mesma obra cai de 1,52 para 0,45 ponto quando se
 * controla por mesmo modelo + mesma versão — ou seja, ~70% da instabilidade medida vem
 * da régua ter mudado, não do modelo.
 *
 * ⚠️ Ao mudar o prompt de propósito: bump da `PROMPT_VERSION` + atualize o hash abaixo,
 * NA MESMA mudança. O hash cobre também as rubricas interpoladas de `CRITERIA_RUBRICS`
 * e as descrições de `CRITERIA_INFO` — se `sync-constants` alterar uma faixa ou uma
 * descrição, a régua mudou de verdade e a versão também precisa mudar.
 *
 * ⚠️ Só é seguro EMENDAR uma versão (mexer no texto sem bump) enquanto ela não produziu
 * nenhuma avaliação: `select count(*) from ai_evaluations where prompt_version = 'vNN'`
 * precisa dar zero nos DOIS bancos. Foi assim que o v23 deixou de poder ser emendado —
 * uma avaliação rodou no local entre dois commits.
 */
describe("PROMPT_VERSION acompanha o texto do prompt", () => {
  /** Versão e sha256 do SYSTEM_PROMPT andam JUNTOS — atualize os dois na mesma mudança. */
  const PINNED_VERSION = "v25"
  const PINNED_SHA256 = "bbe6a7e4577cf6c6032b25bc0f84b8931605b02900720ef8bd7dcd53dfd4e8f2"

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

  it("não reusa um número de versão já gasto no log de chamadas", () => {
    // `ai_api_calls` tem 65 chamadas de `ai_evaluation` rotuladas "v24" (2026-07-29),
    // de uma rodada cujas avaliações foram gravadas como v22 — o log e a tabela
    // discordaram. Reusar o número misturaria latência/custo/qualidade do v24 novo com
    // as fantasmas, e a análise sairia inteira plausível. Por isso o v23 pulou pro v25.
    expect(PROMPT_VERSION).not.toBe("v24")
  })
})
