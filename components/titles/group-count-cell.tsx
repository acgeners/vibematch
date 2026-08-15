"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WorkGroupRef } from "@/server/queries/lists"

interface GroupCountCellProps {
  /** Os grupos de favoritos a que esta obra pertence. Vazio = nenhum. */
  groups: WorkGroupRef[]
  /** Numa página de grupo, o grupo que a tabela já está exibindo: ele aparece na lista
   *  apagado, porque nessa tela ele é o óbvio — o que interessa é o que vem ALÉM dele. */
  currentGroupId?: string
}

/**
 * Recorrência de uma obra nos grupos de favoritos: o NÚMERO na célula, os NOMES no hover.
 *
 * 🔴 Por que não um chip colorido ou uma medalha:
 *  - 36% das favoritas estão em 2+ grupos (medido em 2026-08-15, 46 de 126). Destaque aceso
 *    em uma linha a cada três é o alarme que ninguém lê — a régua que já mantém o
 *    Alinhamento fora dos chips de lista.
 *  - a COR não identifica grupo: os 12 grupos de hoje usam 4 cores, e três deles ("Spicy",
 *    "Best Spicy", "Fotos boas") dividem o mesmo rosa. Um ponto colorido por grupo seria
 *    ambíguo por construção, então quem nomeia é o tooltip.
 *
 * A bolinha de cor aparece só DENTRO do tooltip, ao lado do nome — ali ela decora um rótulo
 * que já está escrito, e não carrega sozinha a identificação.
 */
/**
 * O corpo do tooltip: os NOMES dos grupos, um por linha, com a bolinha da cor ao lado.
 *
 * Exportado porque o Radix Tooltip não abre em jsdom (conferido: nem `pointerMove` nem
 * `focus` mudam o `data-state`) — sem isto, a única forma de travar o conteúdo seria
 * casar strings no source, e teste que casa grafia protege a grafia, não o fato.
 */
export function GroupNamesList({ groups, currentGroupId }: GroupCountCellProps) {
  return (
    <>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-background/60">
        em {groups.length} grupo{groups.length !== 1 ? "s" : ""}
      </p>
      <ul className="space-y-0.5 text-xs">
        {groups.map((g) => (
          <li
            key={g.id}
            className={
              g.id === currentGroupId
                ? "flex items-center gap-1.5 text-background/50"
                : "flex items-center gap-1.5"
            }
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: g.color ? `hsl(${g.color})` : "currentColor" }}
            />
            {g.name}
          </li>
        ))}
      </ul>
    </>
  )
}

export function GroupCountCell({ groups, currentGroupId }: GroupCountCellProps) {
  if (groups.length === 0) {
    // "Em nenhum grupo" é um fato sobre a obra, não um dado faltando — daí o traço neutro,
    // o mesmo que as outras colunas usam para vazio.
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex h-6 min-w-6 cursor-default items-center justify-center rounded-md border bg-secondary px-1.5 text-xs font-semibold tabular-nums text-secondary-foreground">
          {groups.length}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <GroupNamesList groups={groups} currentGroupId={currentGroupId} />
      </TooltipContent>
    </Tooltip>
  )
}
