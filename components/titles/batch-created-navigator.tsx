"use client"

import { useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { titleToSlug } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface BatchCreatedItem {
  id: string
  title: string
}

interface BatchCreatedNavigatorProps {
  currentId: string
}

export function BatchCreatedNavigator({ currentId }: BatchCreatedNavigatorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const batch = useMemo(() => {
    const raw = searchParams.get("batch")
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as BatchCreatedItem[]
      return Array.isArray(parsed) ? parsed.filter((item) => item.id && item.title) : []
    } catch {
      return []
    }
  }, [searchParams])

  if (batch.length <= 1) return null

  const currentIndex = Math.max(0, batch.findIndex((item) => item.id === currentId))
  const currentItem = batch[currentIndex]

  const navigateToIndex = (index: number) => {
    const nextItem = batch[index]
    if (!nextItem) return
    const params = new URLSearchParams()
    params.set("batch", JSON.stringify(batch))
    params.set("batchIndex", String(index))
    router.push(`/catalog/${titleToSlug(nextItem.title)}?${params.toString()}`)
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {currentIndex + 1}/{batch.length}
          </p>
          <p className="truncate text-sm font-semibold">{currentItem?.title}</p>
          <p className="text-sm text-muted-foreground">Lote criado. Navegue pelas obras geradas.</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={currentIndex === 0}
            onClick={() => navigateToIndex(currentIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={currentIndex >= batch.length - 1}
            onClick={() => navigateToIndex(currentIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
