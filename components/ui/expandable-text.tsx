"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface ExpandableTextProps {
  text: string
  limit: number
  className?: string
  buttonClassName?: string
}

function truncateAtWord(text: string, limit: number) {
  if (text.length <= limit) return text
  const slice = text.slice(0, limit)
  const lastSpace = slice.lastIndexOf(" ")
  return `${slice.slice(0, lastSpace > limit * 0.7 ? lastSpace : limit).trimEnd()}...`
}

export function ExpandableText({
  text,
  limit,
  className,
  buttonClassName,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const shouldTruncate = text.length > limit
  const visibleText = shouldTruncate && !expanded ? truncateAtWord(text, limit) : text

  return (
    <div className="space-y-0.5">
      <p className={cn("whitespace-pre-line", className)}>{visibleText}</p>
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            "flex items-center gap-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors",
            buttonClassName
          )}
          aria-label={expanded ? "Recolher texto" : "Expandir texto"}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  )
}
