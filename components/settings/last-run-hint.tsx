"use client"

import { useEffect, useState } from "react"

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "nunca"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "nunca"
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "agora há pouco"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `há ${days}d`
  return date.toLocaleDateString("pt-BR")
}

interface LastRunHintProps {
  iso: string | null | undefined
  label?: string
  className?: string
}

export function LastRunHint({ iso, label = "Última execução", className }: LastRunHintProps) {
  // Date.now() differs between SSR and client hydrate — render "—" first, then
  // populate after mount. Refresh every 30s so the relative text stays live.
  const [text, setText] = useState<string>("—")
  useEffect(() => {
    const update = () => setText(formatRelativeTime(iso))
    update()
    const id = setInterval(update, 30_000)
    return () => clearInterval(id)
  }, [iso])

  return (
    <span
      className={className ?? "text-[11px] text-muted-foreground"}
      suppressHydrationWarning
      title={iso ? new Date(iso).toLocaleString("pt-BR") : undefined}
    >
      {label}: {text}
    </span>
  )
}
