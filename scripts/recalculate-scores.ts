/**
 * CLI de recálculo global GRATUITO headless-safe (Etapa 2B.2).
 *
 * ALVO: NUVEM por padrão declarado — mas o alvo NUNCA é implícito: ele vem na linha de
 * comando (`--cloud` ou `--local`) e é conferido contra a URL efetiva antes de qualquer
 * leitura. Ver o 🔴 abaixo.
 *
 * Superfície mínima e SEGURA: reusa o contrato central `ensureRecalculateScores`
 * via `recalculateScoresHeadless` (recalculateAll no caminho "headless" — leituras
 * uncached, sem `revalidate*`). NÃO chama LLM, NÃO regenera perfil, NÃO prevê obras,
 * custo = US$ 0. Global/coalescido/`work_id=null`. Retoma o job `failed`/pendente
 * existente (mesma dedup key) e zera `recalc_pending` no sucesso.
 *
 * Uso:
 *   npm run recalc:scores:cloud    # grava na NUVEM — o catálogo que os leitores veem
 *   npm run recalc:scores:local    # grava no clone LOCAL descartável
 *   npm run recalc:scores          # NÃO roda: exige que você escolha um dos dois
 *
 *  - fresh (recalc_pending=false) ⇒ sai sem job/cálculo (exit 0);
 *  - pending/failed ⇒ retoma e recalcula uma vez (exit 0 no sucesso, !=0 na falha).
 *
 * 🔴 POR QUE O ALVO É OBRIGATÓRIO NA LINHA DE COMANDO. Até 2026-09-23 o npm script era
 * `--env-file=.env.local --env-file=.env.analysis`, e o último `--env-file` vence: **este
 * comando de ESCRITA gravava no banco LOCAL**, comprovado rodando os três casos. O modo de
 * falha é o caro desta base — com o stack local no ar ele recalcula a réplica e imprime
 * `✓ recalc concluído · recalc_pending agora=false` lendo o local, ou seja anuncia sucesso
 * sobre o banco errado. Erro que produz resultado.
 *
 * ⚠️ A correção NÃO foi trocar a ordem dos `.env`: isso mudaria o alvo em silêncio, que é a
 * mesma classe de defeito com o sinal invertido. O alvo passou a ser DECLARADO e conferido —
 * e os dois continuam alcançáveis, porque recalcular o clone depois de um `db:pull` é uso
 * legítimo.
 *
 * ⚠️ A conferência reusa `isLocalSupabaseUrl` (`lib/db-target.ts`), que é o dono do
 * predicado. Uma segunda regex aqui faria este script aceitar o que o resto do app recusa.
 * Não usa `exigeAlvoNuvem()` porque a mensagem dele fala de `--execute` e de chamada PAGA, e
 * este recálculo é US$0 — a guarda certa com o motivo errado ensina a ignorar a próxima.
 */
import { isLocalSupabaseUrl, supabaseTargetLabel } from "@/lib/db-target"
import { getRecalcPendingState, recalculateScoresHeadless } from "@/server/recalc/queue"

type Alvo = "cloud" | "local"

const COMANDOS: Record<Alvo, string> = {
  cloud: "npm run recalc:scores:cloud",
  local: "npm run recalc:scores:local",
}

/**
 * O alvo pedido na linha de comando. `null` quando não foi declarado — que é motivo de recusa.
 *
 * ⚠️ NÃO exportada de propósito: este módulo chama `main()` na importação, então um teste que
 * a importasse dispararia o script. Quem a exercita é a execução REAL, em
 * `tests/unit/orchestration/recalc-scores-alvo-explicito.test.ts`.
 */
function alvoPedido(argv: readonly string[]): Alvo | null | "ambos" {
  const cloud = argv.includes("--cloud")
  const local = argv.includes("--local")
  if (cloud && local) return "ambos"
  if (cloud) return "cloud"
  if (local) return "local"
  return null
}

function recusar(linhas: string[]): never {
  console.error(["", ...linhas, ""].join("\n"))
  process.exit(1)
}

/**
 * Confere que o alvo DECLARADO é o alvo EFETIVO. As duas direções recusam: pedir `--cloud`
 * com env local gravaria na réplica; pedir `--local` com env de nuvem gravaria em produção
 * achando que era descartável — e essa é a pior das duas.
 */
function exigirAlvoDeclarado(alvo: Alvo): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const rotulo = supabaseTargetLabel(url)

  if (!url) {
    recusar([
      "🔴 RECUSADO — NEXT_PUBLIC_SUPABASE_URL vazio; não dá para saber onde isto gravaria.",
      "",
      `   Rode pelo npm script, que carrega os env certos:  ${COMANDOS[alvo]}`,
    ])
  }

  const ehLocal = isLocalSupabaseUrl(url)

  if (alvo === "cloud" && ehLocal) {
    recusar([
      `🔴 RECUSADO — você pediu --cloud, mas o alvo efetivo é LOCAL (${rotulo}).`,
      "",
      "   O recálculo gravaria na réplica descartável e terminaria anunciando sucesso.",
      "   Provável causa: um `--env-file=.env.analysis` carregado depois do `.env.local`.",
      "",
      `   Para gravar na nuvem:  ${COMANDOS.cloud}`,
      `   Para gravar no clone:  ${COMANDOS.local}`,
    ])
  }

  if (alvo === "local" && !ehLocal) {
    recusar([
      `🔴 RECUSADO — você pediu --local, mas o alvo efetivo é a NUVEM (${rotulo}).`,
      "",
      "   Isto gravaria no catálogo de produção achando que era o clone descartável.",
      "   Provável causa: falta o `--env-file=.env.analysis` (ou o stack local não está no ar).",
      "",
      `   Para gravar no clone:  ${COMANDOS.local}`,
      `   Para gravar na nuvem:  ${COMANDOS.cloud}`,
    ])
  }

  return rotulo
}

async function main() {
  const pedido = alvoPedido(process.argv.slice(2))

  if (pedido === "ambos") {
    recusar([
      "🔴 RECUSADO — --cloud e --local juntos. O alvo tem de ser um só.",
      "",
      `   ${COMANDOS.cloud}`,
      `   ${COMANDOS.local}`,
    ])
  }

  if (pedido === null) {
    recusar([
      "🔴 RECUSADO — este comando GRAVA, e o alvo não foi declarado.",
      "",
      "   Até 2026-09-23 ele escolhia sozinho pela ordem dos `--env-file` e caía no banco",
      "   LOCAL, terminando com `✓ recalc concluído` como se tivesse recalculado a nuvem.",
      "   Agora o alvo é explícito. Escolha:",
      "",
      `   ${COMANDOS.cloud}   # NUVEM — o catálogo que os leitores veem`,
      `   ${COMANDOS.local}   # clone LOCAL descartável`,
    ])
  }

  const rotulo = exigirAlvoDeclarado(pedido)

  // O alvo vai para a tela ANTES de qualquer operação — é o que permite abortar a tempo.
  const nome = pedido === "cloud" ? "NUVEM" : "LOCAL"
  console.log(`alvo: ${nome} · ${rotulo}`)

  const before = await getRecalcPendingState()
  console.log(`estado atual: recalc_pending=${before.pending} · recalc_last_edit_at=${before.lastEditAt ?? "—"}`)

  if (!before.pending) {
    console.log("✓ Nada a fazer — scores já fresh (recalc_pending=false). Sem job, sem cálculo.")
    return
  }

  console.log(`Retomando recálculo global em ${nome} (headless-safe, GRATUITO)…`)
  const out = await recalculateScoresHeadless()

  switch (out.status) {
    case "succeeded": {
      const after = await getRecalcPendingState()
      console.log(
        `✓ recalc concluído em ${nome} (${rotulo}): recalculated=${out.recalculated} · recalc_pending agora=${after.pending}`,
      )
      if (after.pending) {
        console.error("⚠ recalc_pending continua true após sucesso — inesperado.")
        process.exit(1)
      }
      return
    }
    case "fresh":
      console.log("✓ Já estava fresh (corrida benigna).")
      return
    case "processing":
      console.log("• Recálculo já em andamento em outro processo — nada iniciado aqui.")
      return
    case "failed":
      console.error(`✗ recalc falhou (sanitizado): ${out.error}`)
      console.error("  recalc_pending preservado=true; job failed resumível. Rode novamente.")
      process.exit(1)
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
