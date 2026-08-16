"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { SHELVES } from "@/lib/my-list/shelves"
import type { ShelfCounts, ShelfKey } from "@/lib/my-list/shelves"
import type { MyListWork } from "@/server/queries/my-list"

type Aba = ShelfKey | "all"

/**
 * A lista do usuário, particionada por prateleira.
 *
 * 🔴 A cor do chip sai de `personal_status.color`, do BANCO — não de um mapa aqui. Status
 * pessoal já tem cor definida (a mesma que o gráfico de distribuição do painel usa), e uma 2ª
 * paleta para o mesmo fato é como a mesma obra fica azul numa tela e verde na outra. Status
 * novo no Supabase entra colorido sozinho.
 *
 * ⚠️ Isto NÃO usa `STATUS_TONE` (`lib/ui/status-tone.ts`): aquela régua é sobre o estado do
 * SISTEMA (desatualizado, pendente, falhou). Aqui o chip é um fato sobre a sua leitura, outra
 * categoria — misturar as duas é o que fez o âmbar significar cinco coisas na página da obra.
 */
export function MyListView({
  works,
  counts,
  semPrateleira,
}: {
  works: MyListWork[]
  counts: ShelfCounts
  semPrateleira: number
}) {
  const [aba, setAba] = useState<Aba>("all")

  const visiveis = useMemo(
    () => (aba === "all" ? works : works.filter((w) => w.shelf === aba)),
    [works, aba],
  )

  const total = works.length
  const prateleira = SHELVES.find((s) => s.key === aba)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-border/70 pb-4">
        <Chip ativo={aba === "all"} onClick={() => setAba("all")} rotulo="Todas" n={total} />
        {SHELVES.map((s) => (
          <Chip
            key={s.key}
            ativo={aba === s.key}
            onClick={() => setAba(s.key)}
            rotulo={s.label}
            n={counts[s.key]}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {prateleira ? prateleira.hint : "tudo em que você se pronunciou — por status ou por nota sua"}
        {aba === "all" && semPrateleira > 0 && (
          <>
            {" · "}
            <span title="Obras sem status de leitura que mesmo assim têm nota sua — por isso a soma das prateleiras é menor que o total.">
              {semPrateleira} com nota e sem status
            </span>
          </>
        )}
      </p>

      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-border/70 bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma obra nesta prateleira ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visiveis.map((w) => (
            <Linha key={w.id} work={w} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Chip({
  ativo,
  onClick,
  rotulo,
  n,
}: {
  ativo: boolean
  onClick: () => void
  rotulo: string
  n: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        // `ring` e não `border`: utility de cor de borda é morta neste app — a regra
        // `* { border-color }` fora de @layer vence as utilities do Tailwind v4.
        ativo
          ? "bg-primary/12 text-foreground ring-1 ring-primary/40"
          : "bg-card/45 text-muted-foreground ring-1 ring-border/80 hover:bg-card/80 hover:text-foreground",
      )}
    >
      {rotulo}
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-[11px] tabular-nums",
          ativo ? "bg-primary/20 text-foreground" : "bg-border/90 text-muted-foreground",
        )}
      >
        {n}
      </span>
    </button>
  )
}

function Linha({ work }: { work: MyListWork }) {
  const info = work.personalStatusId != null ? PERSONAL_STATUSES_BY_ID[work.personalStatusId] : null
  const lidos = work.chaptersRead ?? 0
  const total = work.totalChapters ?? 0
  const pct = total > 0 ? Math.min(100, Math.round((lidos / total) * 100)) : 0
  const completo = total > 0 && lidos >= total

  return (
    <li className="rounded-xl bg-card/40 transition-colors hover:bg-card/75">
      <Link
        href={`/catalog/${work.id}`}
        className="grid grid-cols-[38px_1fr_auto] items-center gap-3 rounded-xl px-3 py-2 sm:grid-cols-[38px_1fr_150px_128px_58px] sm:gap-3.5"
      >
        <CoverImage
          urls={work.coverUrls}
          alt=""
          className="h-[52px] w-[38px] rounded-md object-cover"
        />

        <span className="min-w-0 truncate text-[13.5px] font-medium">
          {work.isAdult && <span className="mr-1.5 text-red-400/90 text-[11px]">18+</span>}
          {work.title}
        </span>

        {info ? (
          <span
            className="hidden items-center gap-1.5 justify-self-start rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold sm:inline-flex"
            style={{ color: info.color, backgroundColor: `${info.color}22` }}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: info.color }}
            />
            {info.status}
          </span>
        ) : (
          <span className="hidden text-[11.5px] text-muted-foreground sm:inline">sem status</span>
        )}

        {/* Progresso só onde ele significa alguma coisa: "0 / 73" em quem não acompanha lê
            como leitura ABANDONADA, e é só o default de quem nunca abriu a obra. Mesma régua
            da faixa de stats da página da obra. */}
        <span className="hidden flex-col gap-1 sm:flex">
          {info?.tracksProgress && total > 0 ? (
            <>
              <span className="text-[11.5px] tabular-nums text-muted-foreground">
                {lidos}/{total} cap.
              </span>
              <span className="h-1 overflow-hidden rounded-sm bg-border/90">
                <span
                  className={cn("block h-full rounded-sm", completo ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${pct}%` }}
                />
              </span>
            </>
          ) : (
            <span className="text-[11.5px] text-muted-foreground/60">—</span>
          )}
        </span>

        <span className="justify-self-end text-right text-sm font-bold tabular-nums">
          {work.userScore != null ? (
            work.userScore.toFixed(1)
          ) : (
            <span className="font-medium text-muted-foreground/60">—</span>
          )}
        </span>
      </Link>
    </li>
  )
}
