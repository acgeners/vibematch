import Link from "next/link"
import { Inbox } from "lucide-react"
import { getCurationQueue } from "@/server/queries/curation-requests"
import type { CurationRequestKind } from "@/server/queries/curation-requests"
import { ResolveRequestButtons } from "@/components/curadoria/resolve-request-buttons"

/**
 * A fila de pedidos do leitor.
 *
 * Produção não tem bypass de Cloudflare, então tudo que raspa fonte externa é do curador,
 * rodando local. Esta página é o outro lado desse desenho: o leitor pede, isto aparece aqui,
 * você roda o fluxo no Mac e fecha o pedido.
 *
 * ⚠️ Cadastro de obra NÃO aparece aqui — `works.ai_eval_status = 'pending'` já expressa isso e
 * já alimenta "Curadoria da Obra". Duplicar criaria duas fontes de verdade para o mesmo fato.
 */

const ROTULO: Record<CurationRequestKind, { texto: string; cor: string; oQueFazer: string }> = {
  update_data: {
    texto: "atualizar dados",
    cor: "border-amber-500/55 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    oQueFazer: "Rode “Atualizar dados” na obra, no ambiente local.",
  },
  review_eval: {
    texto: "revisar avaliação",
    cor: "border-violet-500/55 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    oQueFazer: "Reavalie a obra com IA, no ambiente local.",
  },
  create_by_name: {
    texto: "cadastrar pelo nome",
    cor: "border-emerald-500/55 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    oQueFazer: "A busca de produção não achou. Procure local, onde as 9 fontes respondem.",
  },
}

function quando(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (dias <= 0) return "hoje"
  if (dias === 1) return "ontem"
  return `${dias} dias`
}

export default async function PedidosPage() {
  const pedidos = await getCurationQueue()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          O que os leitores pediram. Produção não alcança todas as fontes — quem roda estes
          fluxos é você, no ambiente local, e depois empurra com os scripts de push.
        </p>
      </header>

      {pedidos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
          <Inbox className="size-6 text-muted-foreground/60" />
          <p className="text-sm font-semibold">Nenhum pedido em aberto</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Quando alguém pedir atualização, revisão ou o cadastro de uma obra que a busca não
            achou, aparece aqui.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {pedidos.map((p) => {
            const r = ROTULO[p.kind]
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11.5px] font-semibold ${r.cor}`}
                    >
                      {r.texto}
                    </span>
                    {p.workId ? (
                      <Link
                        href={`/titles/${p.workId}`}
                        className="truncate font-semibold hover:underline"
                      >
                        {p.workTitle ?? "(obra sem título)"}
                      </Link>
                    ) : (
                      // Sem obra: o que existe é o texto que a pessoa digitou. Entre aspas pra
                      // deixar claro que é busca dela, não título do catálogo.
                      <span className="truncate font-semibold italic">“{p.query}”</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{r.oQueFazer}</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    {p.requesterName ?? "alguém"} · {quando(p.createdAt)}
                  </p>
                </div>
                <ResolveRequestButtons id={p.id} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
