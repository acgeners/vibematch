"use server"

import { ensureAdmin } from "@/server/queries/current-user"
import {
  carregarObrasDoExperimento,
  experimentoDisponivel,
} from "@/server/queries/criteria-experiment"
import {
  rodarAnalisePrincipal,
  rodarAnaliseSecundaria,
  medirCobertura,
  OFFICIAL_CRITERIA,
  EXPERIMENTAL_CRITERIA,
  DEFAULT_PERMUTATIONS,
  DEFAULT_SEED,
  type Cobertura,
  type ResultadoPrincipal,
  type ResultadoSecundario,
} from "@/lib/model-metrics/criteria-experiment"

/**
 * A ÚNICA porta do harness 9 × 11 — e ela só LÊ.
 *
 * 🔴 Action NOVA e dedicada, em vez de reusar alguma de `settings.ts`/`calculations.ts`: as de
 * lá também escrevem, e reaproveitá-las poria um caminho de escrita a um `if` de distância de
 * uma tela de diagnóstico. Aqui não existe `insert`/`update`/`upsert`/`delete`, não se chama
 * `recalculateAll` nem a fila, e nada toca provider. Guardado por
 * `tests/unit/orchestration/experimento-nao-escreve.test.ts`, que varre a árvore de imports.
 *
 * ⚠️ `ensureAdmin` porque a tela é da console do curador e a leitura cobre o catálogo inteiro.
 */

export interface ProvenanciaDoExperimento {
  executadoEm: string
  seed: number
  permutacoes: number
  criteriosOficiais: readonly string[]
  criteriosExperimentais: readonly string[]
  assinaturaOficial: string
  assinaturaExperimental: string
}

export type RespostaDoExperimento =
  | { ok: false; erro: string }
  | { ok: false; indisponivel: true; faltando: string[] }
  | {
      ok: true
      provenancia: ProvenanciaDoExperimento
      cobertura: Cobertura
      principal: ResultadoPrincipal
      secundaria: ResultadoSecundario
      duracaoMs: number
    }

export async function rodarExperimentoDeCriterios(
  permutacoes: number = DEFAULT_PERMUTATIONS,
): Promise<RespostaDoExperimento> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, erro: gate.error }

  const disp = await experimentoDisponivel()
  if (!disp.disponivel) return { ok: false, indisponivel: true, faltando: disp.faltando }

  const t0 = Date.now()
  let works
  try {
    works = await carregarObrasDoExperimento()
  } catch (e) {
    // `computeRecalc` aborta em estado misto (deploy sem a 198). Devolver a mensagem dele é
    // mais útil que um 500: ela já diz o estado e a saída.
    return { ok: false, erro: (e as Error).message }
  }

  const principal = rodarAnalisePrincipal(works, { permutacoes, seed: DEFAULT_SEED })
  const secundaria = rodarAnaliseSecundaria(works)

  return {
    ok: true,
    duracaoMs: Date.now() - t0,
    cobertura: medirCobertura(works),
    principal,
    secundaria,
    provenancia: {
      executadoEm: new Date().toISOString(),
      seed: DEFAULT_SEED,
      permutacoes,
      criteriosOficiais: OFFICIAL_CRITERIA,
      criteriosExperimentais: EXPERIMENTAL_CRITERIA,
      assinaturaOficial: OFFICIAL_CRITERIA.join(","),
      assinaturaExperimental: EXPERIMENTAL_CRITERIA.join(","),
    },
  }
}

/** Só a cobertura, para o estado inicial da página — barato o bastante para o page load. */
export async function lerCoberturaDoExperimento(): Promise<
  { ok: true; disponivel: boolean; faltando: string[] } | { ok: false; erro: string }
> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, erro: gate.error }
  const d = await experimentoDisponivel()
  return { ok: true, disponivel: d.disponivel, faltando: d.faltando }
}
