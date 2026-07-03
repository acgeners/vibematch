"use client"

import Link from "next/link"
import { Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/** Ícone ♥ do topo do /ranking (atalho pros favoritos) com tooltip explicativo. */
export function FavoritesIconLink({ href }: { href: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" asChild className="size-9">
            <Link href={href} aria-label="Favoritos">
              <Heart className="h-4 w-4 text-rose-500 fill-rose-500/25" />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-[220px] text-pretty">
          Abre os favoritos ♥ com os mesmos filtros do ranking.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
