import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"

/**
 * O CONTRATO DO CÁLCULO: quem entra na Nota.IA tem de ser exatamente quem entra no Ridge.
 *
 * 🔴 POR QUE ISTO EXISTE — o defeito é de IMPLANTAÇÃO, e foi medido. O conjunto de critérios
 * que alimenta a **Nota.IA** sai do BANCO (`gpt.ts` itera `score_weights` filtrando
 * `is_active`), enquanto o que alimenta o **Ridge, a Bússola, os embeddings e a guarda de
 * `expected_score`** sai do CÓDIGO (`SCORING_CRITERION_SLUGS`, congelada). Os dois só
 * concordam por combinação — e deploy e migration são eventos SEPARADOS, então existe uma
 * janela em que discordam.
 *
 * Medido contra a nuvem em 2026-09-22, nos quatro estados do rollout dos 11:
 *
 *   A · código antigo + banco atual    → coerente
 *   B · código NOVO   + banco atual    → 🔴 Nota.IA sobre `fantasy_nobility`, Ridge sobre `fantasy`
 *   C · código antigo + banco pós-198  → 🔴 Nota.IA sobre `fantasy`, Ridge sobre `fantasy_nobility`
 *   D · código NOVO   + banco pós-198  → coerente
 *
 * Metade do contrato antigo e metade do novo na MESMA rodada. Hoje o dano seria quase
 * invisível (as duas colunas são cópias em 1.025 das 1.026 obras), e é justamente isso que o
 * torna perigoso: ele escreve `calculated_scores` do catálogo inteiro sem erro e sem log, e
 * cresce sozinho conforme avaliações reais chegam.
 *
 * ⚠️ FAIL-HARD de propósito. Recalc que não roda deixa nota velha na tela e `recalc_pending`
 * de pé — recuperável no minuto seguinte. Recalc híbrido grava número errado em 1.027 obras e
 * só é descoberto por quem for comparar. Entre as duas, a barulhenta é a certa.
 *
 * ⚠️ NÃO tem escape hatch, e é escolha: uma flag de "ignorar o contrato" viraria o caminho
 * normal no primeiro rollout apertado. Quem precisa rodar em estado misto muda o estado, não
 * a guarda.
 */
export interface ContratoDoCalculo {
  ok: boolean
  /** No código (Ridge) e AUSENTE dos pesos ativos ⇒ a Nota.IA ignora o critério. */
  faltandoNosPesos: string[]
  /** Ativo nos pesos e FORA do código ⇒ a Nota.IA conta um critério que o Ridge não vê. */
  sobrandoNosPesos: string[]
}

export function conferirContratoDoCalculo(
  weights: ReadonlyArray<{ slug: string; is_active?: boolean | null }>,
): ContratoDoCalculo {
  // `gpt.ts` filtra `is_active` — a comparação tem de ser sobre o MESMO recorte, senão a
  // guarda aprovaria um banco cujo conjunto ativo diverge e reprovaria um que só tem linha
  // desligada sobrando (que é inofensiva).
  const ativos = new Set(weights.filter((w) => w.is_active).map((w) => w.slug))
  const noCodigo = new Set<string>(SCORING_CRITERION_SLUGS)
  const faltandoNosPesos = [...noCodigo].filter((s) => !ativos.has(s))
  const sobrandoNosPesos = [...ativos].filter((s) => !noCodigo.has(s))
  return {
    ok: faltandoNosPesos.length === 0 && sobrandoNosPesos.length === 0,
    faltandoNosPesos,
    sobrandoNosPesos,
  }
}

/** A mensagem que o operador lê — diz o estado, o porquê e a saída. */
export function mensagemDeContratoQuebrado(c: ContratoDoCalculo): string {
  const partes: string[] = []
  if (c.sobrandoNosPesos.length)
    partes.push(`ATIVOS em score_weights e fora do cálculo: ${c.sobrandoNosPesos.join(", ")}`)
  if (c.faltandoNosPesos.length)
    partes.push(`no cálculo e NÃO ativos em score_weights: ${c.faltandoNosPesos.join(", ")}`)
  return (
    `recálculo ABORTADO: score_weights e SCORING_CRITERION_SLUGS descrevem critérios diferentes ` +
    `(${partes.join(" · ")}). A Nota.IA sairia de um conjunto e o Ridge de outro — metade do ` +
    `contrato antigo, metade do novo, em 1.027 obras, sem erro visível. Nada foi gravado e ` +
    `recalc_pending continua de pé. Isto é o estado ESPERADO entre o deploy e a migration 198: ` +
    `aplique a migration e o recálculo volta sozinho no gatilho seguinte.`
  )
}
