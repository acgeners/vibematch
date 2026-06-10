"use client"

import { useEffect, useState, type MouseEvent } from "react"
import { Heart } from "lucide-react"
import { toast } from "sonner"
import { toggleFavorite } from "@/server/actions/works"
import { cn } from "@/lib/utils"

export function FavoriteCell({
  workId,
  workTitle,
  isFavorite: initialIsFavorite,
}: {
  workId: string
  workTitle: string
  isFavorite: boolean
}) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [pending, setPending] = useState(false)

  // Re-sync optimistic state when the prop changes (após o revalidate da action).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsFavorite(initialIsFavorite)
  }, [initialIsFavorite])

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation()
    if (pending) return
    const next = !isFavorite
    setIsFavorite(next)
    setPending(true)
    const result = await toggleFavorite(workId, next)
    setPending(false)
    if (result.error) {
      setIsFavorite(!next)
      toast.error("Erro ao atualizar favorito")
      return
    }
    // Sem router.refresh() aqui: toggleFavorite já chama revalidatePath das rotas
    // afetadas (/ranking, /titles, /favorites, /titles/:id) e o App Router aplica
    // esse re-render à rota atual na resposta da action. O router.refresh() extra
    // era um SEGUNDO re-render pesado por clique (re-roda getRanking/getWorks). O
    // estado otimista acima mantém o coração instantâneo; em /favorites a linha
    // sai pelo revalidate.
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isFavorite ? `Desfavoritar ${workTitle}` : `Favoritar ${workTitle}`}
      aria-pressed={isFavorite}
      disabled={pending}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-rose-500/10 disabled:opacity-50",
        isFavorite ? "text-rose-500" : "text-muted-foreground hover:text-rose-500"
      )}
    >
      <Heart
        className={cn("h-4 w-4", isFavorite && "fill-current")}
        strokeWidth={isFavorite ? 2 : 1.75}
      />
    </button>
  )
}
