import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/ai-evaluation/service"
import { CRITERION_SLUGS } from "@/types/domain"

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
  /**
   * Versão e sha256 do SYSTEM_PROMPT andam JUNTOS — atualize os dois na mesma mudança.
   *
   * ⚠️ v26 → **v28**, pulando a v27 DE PROPÓSITO. A v27 já nomeia OUTRO prompt na história do
   * projeto (branch `arquivo/prompt-v27`, piloto de 30 obras pago em 11/08 e reprovado), e
   * reusar o número faria "v27" significar duas réguas diferentes — o mesmo motivo pelo qual a
   * v24 nunca virou versão de prompt e a v22 não voltou a ser usada quando a v25 foi revertida.
   * Conferido no banco LOCAL: zero avaliações com `prompt_version = 'v27'`.
   *
   * 🔴 O que mudou nesta versão: `fantasy` e `nobility` entraram em `criteria` (migration 197) e
   * `buildCriteriaPromptSection` passou a enumerar 11 critérios em vez de 9. A régua mudou de
   * verdade — o hash abaixo é a prova.
   */
  const PINNED_VERSION = "v28"
  const PINNED_SHA256 = "0bc85511fe81f83cc2c0d8eead64299bde819aec7dd8247988ddde4436df7a3a"

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
    // `ai_api_calls` tem 65 chamadas de `ai_evaluation` rotuladas "v24" (2026-07-29) —
    // todas de obras do gold set, da investigação que comparou as rubricas v23/v24 contra
    // o julgamento da curadora. `ai_evaluations` gravou v22 nelas porque versão de RUBRICA
    // ≠ versão de PROMPT: dois eixos distintos, cada tabela carregando um. Reusar "v24"
    // como versão de prompt misturaria os dois em qualquer query por `prompt_version`.
    expect(PROMPT_VERSION).not.toBe("v24")
    // v26 é o texto da v22 + a description da migration 181. Rotular de "v22" reusaria
    // caches de uma régua diferente e faria `ai_evaluations.prompt_version` mentir.
    expect(PROMPT_VERSION).not.toBe("v22")
  })

  /**
   * 🔴 O BUMP DA MIGRATION 197 NÃO PODE SER ESQUECIDO.
   *
   * `buildCriteriaPromptSection` itera `CRITERION_SLUGS`, que é GERADO de `criteria`. No dia em
   * que `fantasy`/`nobility` entrarem no banco e `sync-constants` rodar, o SYSTEM_PROMPT ganha
   * dois critérios — a régua muda de verdade — e o hash acima reprova, forçando o bump.
   *
   * Este caso é a outra metade: ele garante que o prompt ENUMERA todos os critérios da lista.
   * Sem ele, alguém poderia "consertar" o vermelho do hash atualizando só o PINNED_SHA256,
   * mantendo uma versão que promete N critérios e entrega outro número.
   *
   * ⚠️ NÃO bumpar a versão antes da migration: uma v27 com texto idêntico ao da v26 é
   * exatamente a mentira que este arquivo existe para impedir.
   */
  it("o prompt enumera TODOS os critérios de CRITERION_SLUGS, um a um", () => {
    for (const [i, slug] of CRITERION_SLUGS.entries()) {
      expect(SYSTEM_PROMPT, `o critério ${slug} não está no prompt`).toContain(`${i + 1}. ${slug} (`)
    }
    // e não enumera um a mais do que a lista tem (casa o FORMATO da seção, não o número solto:
    // o prompt tem outras listas numeradas, e `not.toContain("10. ")` casava uma delas)
    const secao = /^(\d+)\. ([a-z_]+) \(/gm
    const enumerados = [...SYSTEM_PROMPT.matchAll(secao)].map((m) => m[2])
    expect(enumerados).toEqual([...CRITERION_SLUGS])
  })
})
