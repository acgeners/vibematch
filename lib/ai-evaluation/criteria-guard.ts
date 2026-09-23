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
 *
 * 🔴 **A leitura NÃO filtra `eval_type` no servidor, e isso é o que separa dois diagnósticos
 * opostos.** Filtrando `eval_type='IA'` no banco, um slug aposentado (`eval_type='Legado'`)
 * some da resposta e fica **indistinguível** de um slug que nunca existiu — e os dois pedem
 * ações CONTRÁRIAS: o ausente pede migration, o aposentado pede atualizar o CHECKOUT. Medido
 * em 2026-09-23: com o checkout 10 commits atrás, a mensagem mandou "aplique a migration que
 * cria esses critérios" sobre `fantasy_nobility`/`nobility` — e aplicá-la teria REVERTIDO o
 * rollout da 198, que os aposentou de propósito. A informação estava a um `select` de
 * distância. Custo de não filtrar: a tabela tem 31 linhas (**1.293 bytes** medidos), contra
 * ~500 com o filtro.
 */
export async function exigirCriteriosNoBanco(): Promise<void> {
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const supabase = createAdminClient()

  // Sem `.eq("eval_type", "IA")`: o recorte é feito em memória para que um slug APOSENTADO
  // continue visível. Ver o 🔴 do docstring — é ele que separa "falta migration" de
  // "seu código está velho".
  const { data, error } = await supabase.from("criteria").select("slug, eval_type")

  const alvo = supabaseTargetLabel()

  if (error) {
    throw new Error(
      `não consegui conferir a tabela \`criteria\` em ${alvo} antes de avaliar: ${error.message}. ` +
        `Nenhuma chamada paga foi feita.`
    )
  }

  const linhas = (data ?? []) as Array<{ slug: string; eval_type: string | null }>

  if (linhas.length === 0) {
    throw new Error(
      `a tabela \`criteria\` de ${alvo} não devolveu nenhuma linha — sem isso não há o ` +
        `que conferir, e a avaliação gravaria no escuro. Nenhuma chamada paga foi feita.`
    )
  }

  const tipoPorSlug = new Map(linhas.map((l) => [l.slug, l.eval_type]))
  const avaliaveis = new Set(linhas.filter((l) => l.eval_type === "IA").map((l) => l.slug))

  // ⚠️ Zero critério de IA é FALHA, mesmo com a tabela cheia: a régua é a mesma do canário de
  // contrato — uma lista vazia não é "nada divergiu", é "não houve o que conferir".
  if (avaliaveis.size === 0) {
    throw new Error(
      `a tabela \`criteria\` de ${alvo} não tem nenhum critério com \`eval_type='IA'\` — sem ` +
        `isso não há o que conferir, e a avaliação gravaria no escuro. Nenhuma chamada paga ` +
        `foi feita.`
    )
  }

  const faltando = CRITERION_SLUGS.filter((slug) => !avaliaveis.has(slug))
  if (faltando.length === 0) return

  // A bifurcação: existe na tabela com OUTRO eval_type ⇒ o banco está à frente, o código atrás.
  const aposentados = faltando.filter((slug) => tipoPorSlug.has(slug))
  const ausentes = faltando.filter((slug) => !tipoPorSlug.has(slug))

  const comum =
    `Gravar as notas violaria a FK de \`ai_evaluation_scores\` DEPOIS da chamada paga, então ` +
    `a avaliação parou aqui — nenhuma chamada paga foi feita.`

  const partes: string[] = [
    `o banco ${alvo} não aceita ${faltando.length} dos ${CRITERION_SLUGS.length} critérios que ` +
      `o código avalia.`,
  ]

  if (aposentados.length > 0) {
    const detalhe = aposentados
      .map((slug) => `${slug} (eval_type='${tipoPorSlug.get(slug) ?? "?"}')`)
      .join(", ")
    partes.push(
      `APOSENTADOS neste banco: ${detalhe}. Eles EXISTEM na tabela, com outro \`eval_type\` — ` +
        `ou seja o banco está à frente do código, e o provável é que este checkout esteja ` +
        `desatualizado. NÃO aplique migration para recriá-los: isso REVERTERIA a migration que ` +
        `os aposentou. Atualize o código (\`git fetch origin && git log --oneline HEAD..origin/main\`) ` +
        `e rode \`npm run sync-constants\`.`
    )
  }

  if (ausentes.length > 0) {
    partes.push(
      `AUSENTES da tabela: ${ausentes.join(", ")}. Estes não existem em \`criteria\` sob nenhum ` +
        `\`eval_type\`, então aqui falta mesmo a migration que os cria — ou o app aponta para um ` +
        `banco que ainda não a recebeu (\`npm run db:local\` / \`npm run db:cloud\`). Depois dela, ` +
        `rode \`npm run sync-constants\`.`
    )
  }

  throw new Error(`${partes.join(" ")} ${comum}`)
}
