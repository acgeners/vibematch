"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CoverImage } from "@/components/ui/cover-image"
import { setReadingStatusForWorks } from "@/server/actions/works"
import { personalStatusNameBySlugOrThrow } from "@/lib/constants/status-lookups"
import type { MyList } from "@/server/queries/my-list"

/**
 * A porta de entrada da lista — NÃO é prateleira, e a distinção é medida.
 *
 * 🔴 São **693 obras contra 295** (2,4× tudo o que está na lista somado, 70,5% do catálogo).
 * Como aba irmã de "Terminadas (87)" ela dominaria a página e inverteria o significado dela:
 * "minha lista" passaria a ser majoritariamente o que NÃO é a sua lista. Mesma régua do
 * "alarme que sempre toca" do `db:health` e do painel "Estado da obra".
 *
 * Por isso: regra tracejada separando, número no cabeçalho, e o gesto aqui é **dar status** —
 * não percorrer a pilha. Quem quer percorrer vai pro catálogo filtrado, que já existe.
 *
 * ⚠️ MAL e AnimePlanet não têm aba "untracked" na lista do usuário: obra que você nunca tocou
 * simplesmente está no catálogo. A zona existe porque aqui o catálogo já vem populado, então
 * "nunca tocada" é um estado com volume — mas ela é entrada, não prateleira.
 */
export function UntrackedEntry({
  foraDaLista,
  paraTriar,
}: {
  foraDaLista: number
  paraTriar: MyList["paraTriar"]
}) {
  const [aberto, setAberto] = useState(true)
  const [decididas, setDecididas] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()

  const decidir = (id: string, status: string) => {
    setErro(null)
    startTransition(async () => {
      const res = await setReadingStatusForWorks([id], status)
      // A action devolve `{ error }` em vez de lançar; sem este ramo a UI marcaria como
      // resolvida uma escrita que falhou — plausível, errado, sem log.
      if (res?.error) {
        setErro(res.error)
        return
      }
      setDecididas((d) => ({ ...d, [id]: status }))
    })
  }

  if (foraDaLista <= 0) return null

  return (
    <section className="mt-8 border-t border-dashed border-border pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">Ainda não na sua lista</h2>
        <span className="text-base font-bold tabular-nums text-muted-foreground">{foraDaLista}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/catalog"
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground ring-1 ring-border/80 transition-colors hover:text-foreground"
          >
            Ver no catálogo
          </Link>
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            aria-expanded={aberto}
            className="rounded-lg bg-primary/12 px-3.5 py-2 text-[13px] font-semibold ring-1 ring-primary/40 transition-colors hover:bg-primary/20"
          >
            {aberto ? "Recolher" : "Triar agora"}
          </button>
        </div>
      </div>

      <p className="mt-2 max-w-[74ch] text-xs text-muted-foreground">
        Obras do catálogo em que você nunca se pronunciou. Dar um status aqui move a obra para a
        lista acima. Mostrando as que entraram por último no catálogo.
      </p>

      {erro && <p className="mt-3 text-xs font-medium text-rose-400">{erro}</p>}

      {aberto && (
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {paraTriar.map((w) => {
            const decidida = decididas[w.id]
            return (
              <li
                key={w.id}
                className={`flex gap-3 rounded-xl bg-card/55 p-3 ring-1 ring-border/80 ${decidida ? "opacity-60" : ""}`}
              >
                <CoverImage
                  urls={w.coverUrls}
                  alt=""
                  className="h-[62px] w-[44px] shrink-0 rounded-md object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link href={`/catalog/${w.id}`} className="line-clamp-2 text-[13px] font-medium hover:underline">
                    {w.title}
                  </Link>
                  {decidida ? (
                    <span className="text-[11.5px] font-semibold text-emerald-400">
                      ✓ movida para “{decidida}”
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {/* Os status vêm por SLUG e ESTOURAM num rename — escrever "Want to Read"
                          aqui faria o botão parar de casar em silêncio, que é o bug que a
                          migration 155 documenta. */}
                      {[
                        personalStatusNameBySlugOrThrow("want-to-read"),
                        personalStatusNameBySlugOrThrow("reading"),
                        personalStatusNameBySlugOrThrow("not_now"),
                      ].map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={pendente}
                          onClick={() => decidir(w.id, status)}
                          className="rounded-md bg-card px-2 py-1 text-[11.5px] font-semibold ring-1 ring-border transition-colors hover:bg-primary/15 hover:ring-primary/40 disabled:opacity-50"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
