"use client"

import { SlidersHorizontal, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Gatilho do refino por mood na barra de uma LISTA (/ranking e /favorites).
 *
 * 🔴 É um BOTÃO que abre o popup, e não a barra de controles permanente que foi
 * recusada quando o refino nasceu ("além de poluir a tela, não é sempre que vai
 * ser usado"). O popup é o mesmo do comparador — o que muda é o alcance: ali ele
 * desempata um punhado de obras, aqui reordena a lista.
 *
 * ⚠️ O estado é EFÊMERO de propósito: não vai pra URL nem pros presets salvos.
 * Dois motivos, e o segundo é mecânico — (1) mood é "o que eu quero agora", não
 * configuração de lista; (2) `RankingFilters` reescreve a query string inteira no
 * "Aplicar filtros", então um parâmetro que entrasse por fora do rascunho seria
 * apagado em silêncio, com cara de "o refino não funciona".
 *
 * O preço aceito: o refino se desfaz ao navegar. Por isso o estado ativo é
 * VISÍVEL (chip com o que está ligado) e desfazível num clique — refino que
 * sumisse sem aviso seria pior, mas refino invisível seria pior ainda.
 */
export function MoodListButton({
  active,
  weights,
  exclusions,
  hiddenCount,
  onOpen,
  onClear,
  disabled = false,
  disabledTitle,
}: {
  active: boolean
  /** Dimensões que reordenam (atributos + práticas + capítulos). */
  weights: number
  /** Categorias excluídas — contadas à parte porque se desfazem por outro caminho. */
  exclusions: number
  /** Quantas obras as exclusões tiraram da lista. */
  hiddenCount: number
  onOpen: () => void
  onClear: () => void
  disabled?: boolean
  disabledTitle?: string
}) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        title={
          disabled
            ? disabledTitle
            : "Refinar: dizer o que você quer priorizar agora e reordenar a lista dentro da margem de erro do modelo."
        }
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
          disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Refinar
      </button>
    )
  }

  // ⚠️ O texto nomeia as DUAS coisas separadamente. "3 ajustes" cobrindo peso e
  // exclusão faria a pessoa procurar as obras sumidas no filtro da página.
  const partes = [
    weights > 0 ? `${weights} ajuste${weights !== 1 ? "s" : ""}` : null,
    exclusions > 0
      ? `${hiddenCount} obra${hiddenCount !== 1 ? "s" : ""} fora`
      : null,
  ].filter(Boolean)

  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5"
        title="Mudar o refino"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Refino: {partes.join(" · ")}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Limpar refino"
        title="Limpar refino e voltar à ordenação da lista"
        className="ml-0.5 grid size-5 place-content-center rounded hover:bg-primary/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
