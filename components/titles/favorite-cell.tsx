"use client"

import { useEffect, useState, type MouseEvent } from "react"
import { useRouter } from "next/navigation"
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
  const router = useRouter()
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [pending, setPending] = useState(false)

  // Re-sync optimistic state when the prop changes (e.g. after router.refresh).
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
    router.refresh()
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
