"use client"

import { Scale } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { ARCHETYPE_LABEL } from "@/lib/ranking/tier-composition"
import type { ArchetypeComposition, ForceArchetype } from "@/lib/ranking/tier-composition"

/**
 * Cor de cada tipo de aposta. Mesma família da Bússola (emerald/rose/violet/slate)
 * — é o mesmo arquétipo, e duas paletas para o mesmo conceito ensinariam errado.
 */
const ARCHETYPE_CHIP: Record<ForceArchetype, string> = {
  safe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 ring-emerald-500 dark:text-emerald-300",
  upside: "border-rose-500/40 bg-rose-500/10 text-rose-700 ring-rose-500 dark:text-rose-300",
  niche: "border-violet-500/40 bg-violet-500/10 text-violet-700 ring-violet-500 dark:text-violet-300",
  skip: "border-slate-500/40 bg-slate-500/10 text-slate-600 ring-slate-500 dark:text-slate-300",
}

/**
 * Divisor de TIER inserido entre faixas de Prioridade no ranking. A tabela não
 * mostra mais o número da Prioridade: ela separa as obras em tiers (faixas
 * equivalentes, dentro do erro do modelo) e este divisor marca a fronteira.
 *
 * Híbrido divisor/seção: uma linha destacada com um rótulo "Tier N · N obras".
 * Em tiers de 2+ (`onCompare` definido), oferece "Comparar / Refinar" — abre o
 * fluxo de refino por mood pra desempatar dentro da incerteza.
 */
export function TierDividerRow({
  tierNumber,
  workIds,
  count,
  colSpan,
  onCompare,
  composition,
  focusedArchetype,
  onFocusArchetype,
  selectSlot,
  legendSlot,
}: {
  tierNumber: number
  workIds: string[]
  count: number
  colSpan: number
  /** Quando ausente (tier de 1 obra), o divisor é só separador. */
  onCompare?: (workIds: string[]) => void
  /**
   * DE QUE o tier é feito, por tipo de aposta. O divisor dizia só "N obras de
   * prioridade equivalente" — e "equivalente" vale só na Nota Prevista: dentro do
   * mesmo tier convivem apostas seguras, arriscadas e de nicho. Vazio/ausente =
   * nada a mostrar (sem modelo), e o divisor volta a ser o de antes.
   */
  composition?: ArchetypeComposition
  focusedArchetype?: ForceArchetype | null
  onFocusArchetype?: (a: ForceArchetype) => void
  /**
   * Caixa de "marcar o tier inteiro". Mora à ESQUERDA, na mesma coluna dos
   * checkboxes das linhas de baixo — e não junto do "Comparar / Refinar", onde
   * já convivem os chips de composição e o botão de refino. Alinhada com a
   * coluna de seleção ela se explica sozinha ("marca este bloco"); no canto
   * direito seria a terceira ação disputando o mesmo espaço.
   *
   * Ausente = tier de 1 obra (marcar "o bloco" e marcar a linha seriam a mesma
   * coisa) ou página que não tem seleção.
   */
  selectSlot?: ReactNode
  /**
   * A legenda da coluna "O que a separa" — os 3 ícones de força e o que a régua mede.
   *
   * 🔴 **Ela morava no `<th>` da coluna e veio pra cá (escolha da Ana, 17/08/2026), trocando de
   * lugar com os chips de composição.** No cabeçalho ela custava altura da linha inteira e
   * disputava a largura de UMA coluna; aqui a linha é `colSpan` cheio e sobra espaço. Os chips
   * subiram para junto do rótulo do tier — que é sobre o que eles falam ("6 obras de prioridade
   * equivalente" e DE QUE tipo elas são), então ficaram mais perto do que descrevem do que
   * estavam.
   *
   * ⚠️ Aparece em TODO divisor, não só no primeiro. O `<thead>` é sticky e a legenda no
   * cabeçalho acompanhava a rolagem; aqui ela não acompanha, então repetir por tier é o que
   * mantém a explicação ao alcance de quem está lendo o tier 4.
   */
  legendSlot?: ReactNode
}) {
  return (
    <tr className="bg-gradient-to-r from-primary/10 via-muted/40 to-transparent">
      <td colSpan={colSpan} className="border-y border-primary/25 px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {selectSlot && <span className="flex shrink-0 items-center">{selectSlot}</span>}
          {/*
            🔴 **A contagem mora DENTRO do badge** (escolha da Ana, 17/08/2026). Solta, ela era
            texto nu entre um badge e três pílulas — não era objeto como os vizinhos e não
            pertencia a nenhum dos dois lados. Junta, o badge responde duas coisas de uma vez
            (QUAL tier · de QUE TAMANHO) e os chips ao lado passam a ser só a composição: um
            objeto que identifica o grupo, seguido dos objetos que o decompõem.

            ⚠️ "de prioridade equivalente" saiu da tela e virou `title`. O "≈" já diz o essencial,
            e a frase completa continua alcançável porque é ela que registra que "equivalente"
            vale só no EIXO DA ORDENAÇÃO — dentro do mesmo tier convivem apostas seguras,
            arriscadas e de nicho, que é justamente o que os chips mostram.
          */}
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary"
            title={`${count} ${count === 1 ? "obra" : "obras"} de prioridade equivalente`}
          >
            <span className="font-mono">≈</span>
            Tier {tierNumber}
            <span aria-hidden className="text-primary/40">
              ·
            </span>
            <span className="font-normal normal-case tracking-normal text-primary/80">
              {count} {count === 1 ? "obra" : "obras"}
            </span>
          </span>

          {/* Os chips dizem DE QUE o tier é feito — pertencem ao lado do rótulo que diz de
              quantas obras ele é feito, não ao canto oposto da linha. */}
          <span className="flex items-center gap-1.5">
            {composition?.map(({ archetype, count: n }) => {
              const on = focusedArchetype === archetype
              return (
                <button
                  key={archetype}
                  type="button"
                  onClick={() => onFocusArchetype?.(archetype)}
                  aria-pressed={on}
                  title={`${n} ${n === 1 ? "obra" : "obras"} deste tipo neste tier. Clique para destacar só elas.`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold normal-case tracking-normal transition-colors",
                    ARCHETYPE_CHIP[archetype],
                    on && "ring-2 ring-offset-1 ring-offset-background",
                  )}
                >
                  <span className="tabular-nums">{n}</span>
                  {ARCHETYPE_LABEL[archetype]}
                </button>
              )
            })}
          </span>

          {legendSlot && <span className="ml-auto flex items-center">{legendSlot}</span>}

          {onCompare && (
            <button
              type="button"
              onClick={() => onCompare(workIds)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors",
                "hover:border-primary hover:bg-primary/10",
              )}
              title="Grátis: refina por mood (o que quer priorizar agora) e compara lado a lado pra desempatar. O desempate por IA é opcional, dentro da comparação."
            >
              <Scale className="h-3 w-3" />
              <span>Comparar / Refinar</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
