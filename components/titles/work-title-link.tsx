"use client"

import Link from "next/link"
import { useRef, useState, useSyncExternalStore } from "react"
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
  /** Optional explicit href. Defaults to /titles/{titleToSlug(title)}. */
  href?: string
  className?: string
  children?: React.ReactNode
}

export function WorkTitleLink({ title, workId, preview, href, className, children }: WorkTitleLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [hovered, setHovered] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [loaded, setLoaded] = useState<WorkPreview | null>(preview ?? (workId ? previewCache.get(workId) ?? null : null))
  const mounted = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot)
  const enterTimer = useRef<number | null>(null)
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

  const onEnter = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!canHover) return
    mouse.current = { x: e.clientX, y: e.clientY }
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
    setHovered(false)
  }

  const finalHref = href ?? `/titles/${titleToSlug(title)}`
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
        createPortal(<WorkHoverPreview preview={loaded} anchorRect={rect} />, document.body)}
    </>
  )
}
