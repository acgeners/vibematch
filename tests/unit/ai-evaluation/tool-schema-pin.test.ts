import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { EVALUATION_TOOL, EVAL_OUTPUT_SCHEMA_VERSION } from "@/lib/ai-evaluation/service"

/**
 * O CONTRATO DE SAÍDA tem que andar junto da versão que o rotula — irmão de
 * `prompt-version-pin.test.ts`, para o outro artefato.
 *
 * 🔴 A lacuna que este arquivo fecha: o pin do prompt hasheia o `SYSTEM_PROMPT`, e
 * como ele interpola `buildCriteriaPromptSection()`, rubricas e descriptions vindas
 * do banco JÁ entram naquele hash. A `EVALUATION_TOOL` não entrava em hash nenhum.
 * Ou seja, dava para mudar o que o modelo é obrigado a devolver — campo novo, campo
 * removido, `enum` diferente, `required` diferente, texto de `description` reescrito
 * — sem que nada acusasse, e sem bump de `EVAL_OUTPUT_SCHEMA_VERSION`.
 *
 * Isso importa porque essa constante NÃO é decorativa: ela entra na chave de cache
 * (`canonicalInputHashV2`). Mudar a tool sem bumpar faz o cache servir respostas de
 * um contrato que já não é o vigente — a mesma família do `PROMPT_VERSION` mentindo
 * no banco.
 *
 * ⚠️ O hash é sobre a forma CANÔNICA: chaves de objeto ordenadas (reordenar
 * propriedade é cosmético e não deve gerar alarme), ordem de ARRAY preservada
 * (`enum` e `required` mudarem de conteúdo OU de ordem é mudança de contrato).
 *
 * ⚠️ A tool interpola `CRITERION_SLUGS`, então um critério novo no banco →
 * `sync-constants` → este pin reprova. É o comportamento desejado: critério novo
 * muda o contrato de saída e precisa de versão nova.
 */

/** JSON estável: chaves de objeto ordenadas, arrays intocados. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

describe("EVAL_OUTPUT_SCHEMA_VERSION acompanha o schema da tool", () => {
  /** Versão e sha256 da EVALUATION_TOOL andam JUNTOS — atualize os dois na mesma mudança. */
  const PINNED_VERSION = "eval-2"
  const PINNED_SHA256 = "78728d94856750e12f7244a2255c9f1d9ab429c79a49d87e14b971ec82196c82"

  it("está fixada na versão que este hash descreve", () => {
    expect(EVAL_OUTPUT_SCHEMA_VERSION).toBe(PINNED_VERSION)
  })

  it("o hash da tool bate com o congelado para esta versão", () => {
    const actual = createHash("sha256").update(canonical(EVALUATION_TOOL)).digest("hex")
    expect(
      actual,
      "A EVALUATION_TOOL mudou. Se foi de propósito, faça bump da EVAL_OUTPUT_SCHEMA_VERSION e atualize PINNED_SHA256 neste teste — na MESMA mudança, senão o cache serve respostas de um contrato de saída diferente e a chave de cache mente.",
    ).toBe(PINNED_SHA256)
  })

  it("a forma canônica é estável (reordenar chave não muda o hash)", () => {
    const a = canonical({ x: 1, y: [3, 1, 2] })
    const b = canonical({ y: [3, 1, 2], x: 1 })
    expect(a).toBe(b)
    // mas ordem de ARRAY é conteúdo, não cosmética
    expect(canonical({ y: [1, 2, 3] })).not.toBe(canonical({ y: [3, 2, 1] }))
  })
})
