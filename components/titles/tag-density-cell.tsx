"use client"

import { Ban, Heart } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatTagShare } from "@/lib/tags/density"
import type { TagDensity } from "@/lib/tags/density"

/**
 * "Tags no seu gosto": que FATIA das tags da obra é amada e evitada.
 *
 * A barra é 100% das tags — verde à esquerda, rosa à direita, o meio é o que
 * você nunca opinou. Ela existe porque cinco pares de porcentagens ainda são
 * leitura de número: o pedido era comparar obras de 20 e de 100 tags de relance.
 *
 * ⚠️ O ♥/⊘ não é enfeite: sem ele, qual dos dois números é o de amadas depende
 * só da COR — a mesma razão pela qual a ênfase 2× dos chips é forma, e não um
 * verde mais escuro. Aqui os glifos valem o que valem no popover da nuvem
 * ("Amadas" / "Evitadas"), não o "muito amada" que eles significam DENTRO de um
 * chip: ali marcam o segundo nível, aqui rotulam a seção inteira.
 *
 * ⚠️ O absoluto anda GRUDADO no seu %, nunca num rodapé com os dois juntos: a
 * obra mais magra do catálogo tem **5** tags, e ali cada tag vale 20% — "60%"
 * sozinho lê igual a 60% de 80 tags. Num rodapé "3 · 1 de 5", qual número é
 * qual depende de lembrar a ordem.
 */
export function TagDensityCell({ density }: { density: TagDensity }) {
  const { total, loved, avoided, lovedPct, avoidedPct } = density
  if (total === 0) return <span className="text-xs italic text-muted-foreground">—</span>
  // Piso de 3px pro segmento existente: 1 tag em 261 dá 0,38% da largura, e um
  // fiapo sub-pixel não se distingue de "não tem nenhuma" — que é o fato oposto.
  const seg = (n: number, pct: number | null) =>
    n === 0 ? undefined : { width: `${pct ?? 0}%`, minWidth: "3px" }
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-center gap-2.5 text-[13px] tabular-nums">
        <span
          className={cn(
            "flex items-center gap-1",
            loved > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          <Heart aria-hidden className="h-2.5 w-2.5 shrink-0" fill="currentColor" stroke="none" />
          {formatTagShare(lovedPct)}
          {loved > 0 && <span className="text-[10.5px] opacity-70">({loved})</span>}
        </span>
        {avoided > 0 && (
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <Ban aria-hidden className="h-2.5 w-2.5 shrink-0" strokeWidth={2.75} />
            {formatTagShare(avoidedPct)}
            <span className="text-[10.5px] opacity-70">({avoided})</span>
          </span>
        )}
      </div>
      <div
        aria-hidden
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        title={`${loved} de ${total} tags são amadas (${formatTagShare(lovedPct)})${
          avoided > 0 ? ` · ${avoided} evitadas (${formatTagShare(avoidedPct)})` : ""
        }`}
      >
        {loved > 0 && <span className="bg-emerald-500" style={seg(loved, lovedPct)} />}
        <span className="flex-1" />
        {avoided > 0 && <span className="bg-rose-500" style={seg(avoided, avoidedPct)} />}
      </div>
      <div className="text-center text-[10.5px] tabular-nums text-muted-foreground">
        de {total} tags
      </div>
    </div>
  )
}
