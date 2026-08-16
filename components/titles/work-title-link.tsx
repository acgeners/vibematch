"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"

const noopSubscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false
import { titleToSlug } from "@/lib/utils"
import { getWorkPreview, type WorkPreview } from "@/server/actions/works"
import { WorkHoverPreview } from "@/components/titles/work-hover-preview"

const previewCache = new Map<string, WorkPreview | null>()

interface WorkTitleLinkProps {
  title: string
  /** Optional — used by the lazy fetch. If omitted, hover preview is disabled. */
  workId?: string
  /** Optional eager preview — when provided, no fetch happens. */
  preview?: WorkPreview
  /** Optional explicit href. Defaults to /catalog/{titleToSlug(title)}. */
  href?: string
  className?: string
  children?: React.ReactNode
  /** "compact" → prévia enxuta (view de Cards do /ranking). Default "full". */
  previewVariant?: "full" | "compact"
}

export function WorkTitleLink({ title, workId, preview, href, className, children, previewVariant }: WorkTitleLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [hovered, setHovered] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [loaded, setLoaded] = useState<WorkPreview | null>(preview ?? (workId ? previewCache.get(workId) ?? null : null))
  const mounted = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot)
  const enterTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  const fetching = useRef(false)
  // Latest cursor position over the link. Title links are full-width blocks
  // (`line-clamp`/`block`), so the element rect spans the whole column and its
  // right edge sits far from the visible text — we anchor the preview at the
  // cursor X instead, keeping it next to what the user is actually pointing at.
  const mouse = useRef({ x: 0, y: 0 })

  const canHover = Boolean(preview || workId)

  const startFetch = () => {
    if (loaded || !workId || fetching.current) return
    fetching.current = true
    getWorkPreview(workId)
      .then((result) => {
        previewCache.set(workId, result)
        setLoaded(result)
      })
      .catch(() => {
        // swallow — hover just won't show preview
      })
      .finally(() => {
        fetching.current = false
      })
  }

  // A prévia é INTERATIVA (dá pra levar o mouse pra dentro e clicar em "Ler mais"), então o
  // fechamento é adiado: sair do gatilho agenda um close curto que a própria prévia cancela
  // ao receber o mouse (ponte de hover). Sem isso, o gap gatilho→prévia fecharia no meio.
  const cancelClose = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setHovered(false), 160)
  }

  const onEnter = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!canHover) return
    cancelClose()
    mouse.current = { x: e.clientX, y: e.clientY }
    // Já aberto (o mouse voltou do gatilho depois de passar pela prévia) → não re-ancora.
    if (hovered) return
    // Kick off the fetch immediately so it's likely ready by the time the
    // delay expires. The popup itself still waits 280ms to avoid flicker.
    startFetch()
    if (enterTimer.current) window.clearTimeout(enterTimer.current)
    enterTimer.current = window.setTimeout(() => {
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        // Zero-width rect at the cursor X, spanning the link's vertical extent —
        // the preview flies out beside the cursor, not the far column edge.
        setRect(new DOMRect(mouse.current.x, r.top, 0, r.height))
        setHovered(true)
      }
    }, 280)
  }

  const onMove = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    mouse.current = { x: e.clientX, y: e.clientY }
  }

  const onLeave = () => {
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current)
      enterTimer.current = null
    }
    scheduleClose()
  }

  // Limpa timers pendentes ao desmontar (evita setState em componente fora da árvore).
  useEffect(() => {
    return () => {
      if (enterTimer.current) window.clearTimeout(enterTimer.current)
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [])

  const finalHref = href ?? `/catalog/${titleToSlug(title)}`
  const linkClassName = className ?? "font-medium hover:underline"

  return (
    <>
      <Link
        ref={ref}
        href={finalHref}
        onMouseEnter={onEnter}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className={linkClassName}
      >
        {children ?? title}
      </Link>
      {mounted && hovered && rect && loaded &&
        createPortal(
          <WorkHoverPreview
            preview={loaded}
            anchorRect={rect}
            variant={previewVariant}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          />,
          document.body,
        )}
    </>
  )
}
