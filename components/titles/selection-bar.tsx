"use client"

import { CircleMinus, FolderPlus, Heart, HeartOff, Lightbulb, MoreHorizontal, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCanWriteOwnState } from "@/components/layout/admin-context"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"

/**
 * Barra flutuante da seleção em massa (/catalog, /ranking, /favorites).
 *
 * QUATRO ZONAS, e a régua de cada uma:
 *   1. contexto  — quantas estão selecionadas + como limpar (o X mora junto do contador)
 *   2. usar      — Comparar (primária), Favoritar e Adicionar a grupo; grátis e instantâneo
 *   2b. gerar    — as ações de IA, que GASTAM crédito e demoram minutos
 *   3. retirar   — depois do divisor, e VERMELHO só no que não tem volta
 *
 * A zona 2b existe separada de propósito: ela não é "mais uma ação". Comparar e Favoritar
 * respondem na hora e de graça; Veredito IA e Prever interesse consomem saldo e rodam por
 * minutos no indicador azul. Misturá-las na mesma fileira convidaria ao clique acidental
 * numa ação paga. Páginas que não passam os callbacks (o /catalog) não ganham a zona.
 *
 * Arquivo próprio (e não mais dentro do work-table) porque a régua da zona 3 é testada por
 * RENDER: o que regride aqui não é a fórmula, é o escopo — qual ação ficou vermelha, e se a
 * versão estreita virou menu quando só havia um item.
 */
export function CompareSelectionBar({
  count,
  favoriteCount,
  onOpen,
  onClear,
  onUnfavorite,
  onFavorite,
  onAddToGroup,
  onRemoveFromGroup,
  onRerank,
  onPredictInterest,
  aiDisabledHint,
  busy = false,
}: {
  count: number
  favoriteCount: number
  onOpen: () => void
  onClear: () => void
  onUnfavorite: () => void
  /** Favorita as selecionadas que ainda não são. Omitido = a página não oferece. */
  onFavorite?: () => void
  onAddToGroup?: () => void
  onRemoveFromGroup?: () => void
  /** Zona 2b — Veredito IA em lote. */
  onRerank?: () => void
  /** Zona 2b — Interesse previsto em lote (passa pelo popup de custo). */
  onPredictInterest?: () => void
  /** Motivo pelo qual as ações de IA estão indisponíveis (plano Free, sem perfil…).
   *  Presente = os botões ficam desabilitados COM a explicação no title; ausente = ativos.
   *  Botão apagado sem motivo lê como quebrado. */
  aiDisabledHint?: string
  busy?: boolean
}) {
  // Grupo de favoritos é dado PESSOAL desde a mig 149 (`work_lists.user_id`), e a action é
  // gateada por `own_state` — o mesmo verbo de favoritar. O gate aqui era `isAdmin`, herdado
  // de quando os grupos não tinham dono: ele escondia da Leitora um botão que o servidor
  // aceitaria, e que o menu de pastas da página da obra já oferecia a ela.
  const canWriteOwnState = useCanWriteOwnState()
  if (count === 0) return null
  const compareDisabled = count > MAX_COMPARE_WORKS
  // Quantas ainda NÃO são favoritas — é o que "Favoritar" de fato muda. Sem isso o botão
  // apareceria com "Favoritar 8" numa seleção que já está toda favoritada.
  const unfavoritedCount = Math.max(0, count - favoriteCount)

  // A ZONA DE RETIRAR, e a régua da cor: vermelho é reservado ao que NÃO tem volta.
  // "Tirar do grupo" devolve a obra pro "Sem grupo" e ainda oferece Desfazer no toast;
  // "Desfavoritar" esvazia todas as pastas e refavoritar NÃO recoloca a obra em nenhuma.
  // Até 2026-08-08 era o contrário: a reversível é que era vermelha.
  const removeActions: {
    key: string
    label: string
    icon: typeof CircleMinus
    onClick: () => void
    danger: boolean
  }[] = []
  if (onRemoveFromGroup && canWriteOwnState) {
    removeActions.push({
      key: "remove-group",
      label: "Tirar do grupo",
      icon: CircleMinus,
      onClick: onRemoveFromGroup,
      danger: false,
    })
  }
  if (favoriteCount > 0 && canWriteOwnState) {
    removeActions.push({
      key: "unfavorite",
      label: `Desfavoritar ${favoriteCount}`,
      icon: HeartOff,
      onClick: onUnfavorite,
      danger: true,
    })
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card/95 px-2.5 py-2 shadow-lg backdrop-blur">
        {/* Zona 1 — quantas, e como sair. O X mora JUNTO do contador: solto na outra ponta
            não dizia o que ia limpar. */}
        <span className="inline-flex items-center gap-1 rounded-lg bg-primary/15 py-1 pl-2.5 pr-1 text-xs">
          <span className="font-semibold">{count}</span>
          <span>selecionada{count !== 1 ? "s" : ""}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground hover:text-foreground"
            onClick={onClear}
            aria-label="Limpar seleção"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>

        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

        {/* Zona 2 — o que fazer COM a seleção. Nada aqui apaga nada. */}
        <Button
          size="sm"
          onClick={onOpen}
          disabled={compareDisabled}
          title={compareDisabled ? `Máximo de ${MAX_COMPARE_WORKS} obras para comparar` : undefined}
          className="h-7 text-xs"
        >
          Comparar
        </Button>
        {onFavorite && canWriteOwnState && unfavoritedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onFavorite}
            disabled={busy}
            aria-label={`Favoritar ${unfavoritedCount}`}
            title={`Favoritar ${unfavoritedCount}`}
            className="h-7 gap-1.5 text-xs"
          >
            <Heart className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Favoritar {unfavoritedCount}</span>
          </Button>
        )}
        {onAddToGroup && canWriteOwnState && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAddToGroup}
            disabled={busy}
            aria-label="Adicionar a grupo"
            title="Adicionar a grupo"
            className="h-7 gap-1.5 text-xs"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {/* Abaixo de lg sobra o ícone: na ordem do sacrifício da barra, rótulo cede
                antes de contador e de destino. O nome segue no aria-label. */}
            <span className="hidden lg:inline">Adicionar a grupo</span>
          </Button>
        )}

        {/* Zona 2b — IA. Divisor próprio: gasta crédito e roda por minutos. */}
        {(onRerank || onPredictInterest) && (
          <>
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
            {onRerank && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRerank}
                disabled={busy || Boolean(aiDisabledHint)}
                aria-label="Veredito IA"
                title={aiDisabledHint ?? "Gera o Veredito IA das selecionadas (roda em segundo plano)"}
                className="h-7 gap-1.5 text-xs"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Veredito IA</span>
              </Button>
            )}
            {onPredictInterest && (
              <Button
                size="sm"
                variant="outline"
                onClick={onPredictInterest}
                disabled={busy || Boolean(aiDisabledHint)}
                aria-label="Prever interesse"
                title={aiDisabledHint ?? "Prevê o Interesse das selecionadas (mostra o custo antes)"}
                className="h-7 gap-1.5 text-xs"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Prever interesse</span>
              </Button>
            )}
          </>
        )}

        {removeActions.length > 0 && (
          <>
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

            {/* Zona 3 — o que RETIRA. Larga: botões; estreita: menu (e botão-ícone quando é
                uma ação só, porque menu de um item é o erro do "Explorar ▾" da barra superior). */}
            <div className="hidden items-center gap-1.5 lg:flex">
              {removeActions.map((action) => (
                <Button
                  key={action.key}
                  size="sm"
                  variant="ghost"
                  onClick={action.onClick}
                  disabled={busy}
                  className={cn(
                    "h-7 gap-1.5 text-xs",
                    action.danger
                      ? "text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <action.icon className="h-3.5 w-3.5" />
                  {action.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center lg:hidden">
              {removeActions.length === 1 ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={removeActions[0].onClick}
                  disabled={busy}
                  aria-label={removeActions[0].label}
                  title={removeActions[0].label}
                  className={cn(
                    "size-7",
                    removeActions[0].danger
                      ? "text-rose-500 hover:bg-rose-500/10 hover:text-rose-500"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {(() => {
                    const Icon = removeActions[0].icon
                    return <Icon className="h-3.5 w-3.5" />
                  })()}
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      aria-label="Mais ações"
                      className="size-7 text-muted-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {removeActions.map((action) => (
                      <DropdownMenuItem
                        key={action.key}
                        variant={action.danger ? "destructive" : "default"}
                        onClick={action.onClick}
                      >
                        <action.icon className="mr-2 h-4 w-4" />
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
