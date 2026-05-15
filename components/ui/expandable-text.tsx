"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface ExpandableTextProps {
  text: string
  /** Truncamento por caracteres (modo legado). Ignorado se `maxLines` for usado. */
  limit?: number
  /** Truncamento por número de linhas via CSS line-clamp. Mede overflow no client. */
  maxLines?: number
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
  maxLines,
  className,
  buttonClassName,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    if (maxLines == null) return
    const el = textRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight + 1)
  }, [text, maxLines, expanded])

  useEffect(() => {
    if (maxLines == null) return
    const handle = () => {
      const el = textRef.current
      if (!el) return
      setIsOverflowing(el.scrollHeight > el.clientHeight + 1)
    }
    window.addEventListener("resize", handle)
    return () => window.removeEventListener("resize", handle)
  }, [maxLines])

  if (maxLines != null) {
    const showButton = isOverflowing || expanded
    return (
      <div className="space-y-0.5">
        <p
          ref={textRef}
          className={cn("whitespace-pre-line", className)}
          style={
            expanded
              ? undefined
              : {
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: maxLines,
                  overflow: "hidden",
                }
          }
        >
          {text}
        </p>
        {showButton && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className={cn(
              "flex items-center gap-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors",
              buttonClassName
            )}
            aria-label={expanded ? "Recolher texto" : "Expandir texto"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    )
  }

  const charLimit = limit ?? 600
  const shouldTruncate = text.length > charLimit
  const visibleText = shouldTruncate && !expanded ? truncateAtWord(text, charLimit) : text

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
