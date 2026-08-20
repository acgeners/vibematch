import Link from "next/link"
import { Inbox } from "lucide-react"
import { getCurationQueue } from "@/server/queries/curation-requests"
import type { CurationRequestKind } from "@/server/queries/curation-requests"
import { ResolveRequestButtons } from "@/components/curation/resolve-request-buttons"
import { formatTimeAgo } from "@/lib/date-utils"

/**
 * A fila de pedidos do leitor.
 *
 * Produção não tem bypass de Cloudflare, então tudo que raspa fonte externa é do curador,
 * rodando local. Esta página é o outro lado desse desenho: o leitor pede, isto aparece aqui,
 * você roda o fluxo no Mac e fecha o pedido.
 *
 * 🔴 "Local" aqui é o AMBIENTE DE EXECUÇÃO — o Mac, onde o sidecar e o FlareSolverr moram —,
 * nunca o BANCO. Desde o cutover de 10/08/2026 o `.env.local` aponta pra NUVEM, então o
 * `npm run dev` grava direto em produção e **não existe passo de push**. Esta cópia dizia
 * "depois empurra com os scripts de push" e mandava fazer um trabalho que já não existe: o
 * `db:push-curation` está aposentado (exige `--eu-sei-o-que-estou-fazendo`). Ao reescrever
 * este texto, não devolva a ambiguidade — foi ela que fez a instrução envelhecer sem nada
 * acusar.
 *
 * ⚠️ Cadastro de obra NÃO aparece aqui — `works.ai_eval_status = 'pending'` já expressa isso e
 * já alimenta "Curadoria da Obra". Duplicar criaria duas fontes de verdade para o mesmo fato.
 */

const ROTULO: Record<CurationRequestKind, { texto: string; cor: string; oQueFazer: string }> = {
  update_data: {
    texto: "atualizar dados",
    cor: "border-amber-500/55 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    oQueFazer: "Rode “Atualizar dados” na obra, no dev do Mac.",
  },
  review_eval: {
    texto: "revisar avaliação",
    cor: "border-violet-500/55 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    oQueFazer: "Reavalie a obra com IA, no dev do Mac.",
  },
  create_by_name: {
    texto: "cadastrar pelo nome",
    cor: "border-emerald-500/55 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    oQueFazer: "A busca de produção não achou. Procure no dev do Mac, onde as 9 fontes respondem.",
  },
  /**
   * 🔴 A instrução aqui é o motivo de este tipo existir. "A capa é de outra obra" pendurado num
   * `update_data` cairia sob "Rode 'Atualizar dados'" — que não conserta, porque a fonte externa
   * costuma trazer o mesmo dado errado, e porque parte da ficha é curadoria (título normalizado,
   * tags, piso 18+, vínculo de fonte). Ver migration 195.
   */
  report_error: {
    texto: "erro na ficha",
    cor: "border-rose-500/55 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    oQueFazer: "Corrija na ficha, à mão. Rebuscar não resolve se a fonte também estiver errada.",
  },
}

/**
 * ⚠️ A data sai de `formatTimeAgo`, e não de uma conta local — esta página TINHA a sua, e as
 * duas discordavam sobre o mesmo pedido: a daqui media 24h corridas
 * (`floor(ms / 86_400_000)`) e a do leitor mede dia de CALENDÁRIO. Pedido feito ontem às 23h e
 * aberto hoje às 8h saía como "ontem" na obra e "hoje" na fila. Acima de 30 dias a divergência
 * ficava maior ainda: lá vira data, aqui virava "45 dias".
 */

export const metadata = { title: "Pedidos" }

export default async function PedidosPage() {
  const pedidos = await getCurationQueue()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          O que os leitores pediram. Produção não tem o bypass de Cloudflare — quem roda estes
          fluxos é você, no dev do Mac, onde o sidecar responde. O app já grava na nuvem: não
          há push depois.
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
                        href={`/catalog/${p.workId}`}
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
                  {/* O que a pessoa escreveu vem ANTES da instrução: num `report_error` ele é o
                      pedido inteiro, e a instrução é genérica. Citação, não parágrafo solto —
                      é texto de outra pessoa dentro de uma tela de trabalho. */}
                  {p.note && (
                    <blockquote className="relative mt-2 overflow-hidden rounded-md bg-muted/50 py-2 pr-3 pl-3.5 text-sm whitespace-pre-wrap">
                      {/* Trilho por `<span>`, não `border-l-*`: a regra `* { border-color }` fora
                          de @layer no globals.css mata toda utility de cor de borda (TW v4). */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] bg-muted-foreground/35"
                      />
                      “{p.note}”
                    </blockquote>
                  )}
                  <p className="mt-1.5 text-sm text-muted-foreground">{r.oQueFazer}</p>
                  <p className="mt-1 text-xs text-muted-foreground/80">
                    {p.requesterName ?? "alguém"} · {formatTimeAgo(p.createdAt)}
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
