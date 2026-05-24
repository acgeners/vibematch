"use client"

import { useEffect, useState } from "react"

const PREFIX = "filters-collapsed:"

export function useCollapsedFilters(key: string) {
  const [collapsed, setCollapsed] = useState(false)
  const storageKey = PREFIX + key

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw === "1") setCollapsed(true)
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0")
    } catch {}
  }, [collapsed, storageKey])

  return [collapsed, setCollapsed] as const
}
