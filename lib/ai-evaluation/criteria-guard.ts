import "server-only"
import { CRITERION_SLUGS } from "@/types/domain"
import { supabaseTargetLabel } from "@/lib/db-target"

/**
 * Confere que o banco ALVO conhece os critérios que o código avalia — **antes** de gastar.
 *
 * 🔴 **O defeito que ela existe para impedir custa dinheiro e descarta o que foi pago.**
 * `ai_evaluation_scores.criterion_slug` tem FK para `criteria.slug`, e a gravação acontece
 * DEPOIS da chamada ao modelo (`server/actions/ai.ts`). Quando `CRITERION_SLUGS` anda à frente
 * do banco — o caso medido em 2026-09-21: o código com 11 slugs contra a nuvem com 9, porque a
 * migration 197 (Fantasy/Nobility) só tinha sido aplicada no local — o provider responde, o
 * insert viola a FK e o `throw` acontece **antes** do update que grava
 * `summary`/`model_name`/`raw_response`. Retrato da linha que sobrou: `status = failed` com
 * todos esses campos **vazios**, e **US$0,0647** já debitados. Repetir o clique repete o débito.
 *
 * ⚠️ **Falha FECHADA, ao contrário do gate de `markRecalcPending`** — e o motivo é a assimetria
 * do custo. Lá, na dúvida, marcar um badge a mais custa um clique; aqui, na dúvida, seguir custa
 * uma chamada paga que vai ser jogada fora. Não conseguir LER `criteria` também aborta: sem a
 * leitura não se sabe se o banco aceita as notas, e "não avaliei" é reversível de graça.
 *
 * ⚠️ **Zero linha é FALHA, nunca sucesso** — mesma régua do canário de contrato. Uma lista
 * vazia faria o `filter` abaixo devolver tudo como ausente, ou, pior num outro arranjo, não
 * acusar nada: em nenhum dos dois houve o que conferir.
 *
 * ⚠️ Mora no entry point (`requestAiEvaluation`) e não nos call sites: são TRÊS hoje
 * (`server/actions/ai.ts`, `server/actions/external.ts`, `lib/external/ai-criteria.ts`) e quem
 * a espalhasse por eles deixaria o quarto nascer descoberto. Roda também no caminho de CACHE,
 * de propósito — um hit devolve os mesmos slugs e bateria na mesma FK, só que de graça.
 *
 * ⚠️ Custo: um `select` de uma coluna numa tabela de 27 linhas, contra uma avaliação que leva
 * ~17–20s. `criteria` não está entre as tabelas grandes, então não precisa de paginação.
 */
export async function exigirCriteriosNoBanco(): Promise<void> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const supabase = createAdminClient()

  const { data, error } = await supabase.from("criteria").select("slug").eq("eval_type", "IA")

  const alvo = supabaseTargetLabel()

  if (error) {
    throw new Error(
      `não consegui conferir a tabela \`criteria\` em ${alvo} antes de avaliar: ${error.message}. ` +
        `Nenhuma chamada paga foi feita.`
    )
  }

  const noBanco = new Set((data ?? []).map((linha) => (linha as { slug: string }).slug))

  if (noBanco.size === 0) {
    throw new Error(
      `a tabela \`criteria\` de ${alvo} não devolveu nenhum critério de IA — sem isso não há o ` +
        `que conferir, e a avaliação gravaria no escuro. Nenhuma chamada paga foi feita.`
    )
  }

  const faltando = CRITERION_SLUGS.filter((slug) => !noBanco.has(slug))

  if (faltando.length > 0) {
    throw new Error(
      `o banco ${alvo} não conhece ${faltando.length} dos ${CRITERION_SLUGS.length} critérios que ` +
        `o código avalia: ${faltando.join(", ")}. Gravar as notas violaria a FK de ` +
        `\`ai_evaluation_scores\` DEPOIS da chamada paga, então a avaliação parou aqui — ` +
        `nenhuma chamada paga foi feita. Aplique neste banco a migration que cria esses ` +
        `critérios, ou aponte o app para um banco que já a tenha (\`npm run db:local\` / ` +
        `\`npm run db:cloud\`) e rode \`npm run sync-constants\`.`
    )
  }
}
