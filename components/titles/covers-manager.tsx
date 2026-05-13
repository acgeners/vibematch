"use client"

import { useState } from "react"
import { ImageIcon, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PLATFORMS } from "@/types/domain"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"

export interface CoverEntry {
  url: string
  source: string
  isPrimary: boolean
}

interface CoversManagerProps {
  value: CoverEntry[]
  onChange: (next: CoverEntry[]) => void
}

const SOURCE_OPTIONS = [...PLATFORMS, "manual" as const]

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export function CoversManager({ value, onChange }: CoversManagerProps) {
  const [newUrl, setNewUrl] = useState("")
  const [newSource, setNewSource] = useState<string>("manual")
  const [error, setError] = useState<string | null>(null)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())

  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))

  const handleAdd = () => {
    const trimmed = newUrl.trim()
    if (!trimmed) {
      setError("URL obrigatória")
      return
    }
    if (!isHttpUrl(trimmed)) {
      setError("URL precisa começar com http:// ou https://")
      return
    }
    if (value.some((c) => c.url === trimmed)) {
      setError("Essa URL já está na lista")
      return
    }
    setError(null)
    const next: CoverEntry = {
      url: trimmed,
      source: newSource || "manual",
      isPrimary: value.length === 0,
    }
    onChange([...value, next])
    setNewUrl("")
    setNewSource("manual")
  }

  const handleDelete = (url: string) => {
    const removed = value.find((c) => c.url === url)
    const remaining = value.filter((c) => c.url !== url)
    // If we removed the primary, promote the first remaining (if any).
    if (removed?.isPrimary && remaining.length > 0 && !remaining.some((c) => c.isPrimary)) {
      remaining[0] = { ...remaining[0], isPrimary: true }
    }
    onChange(remaining)
  }

  const handleSetPrimary = (url: string) => {
    onChange(value.map((c) => ({ ...c, isPrimary: c.url === url })))
  }

  const handleSourceChange = (url: string, source: string) => {
    onChange(value.map((c) => (c.url === url ? { ...c, source } : c)))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Capas ({value.length})</Label>
        <p className="text-xs text-muted-foreground">
          Marque <strong>Primária</strong> para definir qual aparece nos cards.
        </p>
      </div>

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Nenhuma capa cadastrada. Adicione uma URL abaixo.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((cover) => {
            const failed = failedUrls.has(cover.url)
            return (
              <div
                key={cover.url}
                className={`relative overflow-hidden rounded-md border ${
                  cover.isPrimary ? "border-primary ring-2 ring-primary/40" : "border-muted"
                }`}
              >
                <div className="aspect-[2/3] bg-muted">
                  {failed ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-6 w-6 opacity-50" />
                      <span className="text-[10px]">indisponível</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cover.url}
                      alt={`Capa (${cover.source})`}
                      className="h-full w-full object-cover"
                      onError={() => markFailed(cover.url)}
                    />
                  )}
                </div>

                <div className="space-y-2 bg-card p-2">
                  <select
                    value={cover.source}
                    onChange={(e) => handleSourceChange(cover.url, e.target.value)}
                    className="block w-full rounded border bg-background px-1.5 py-1 text-[10px] uppercase tracking-wide"
                  >
                    {SOURCE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {PLATFORM_LABELS[opt] ?? opt}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between gap-1 text-xs">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="cover-primary"
                        checked={cover.isPrimary}
                        onChange={() => handleSetPrimary(cover.url)}
                      />
                      Primária
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDelete(cover.url)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remover capa"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <Label className="text-xs text-muted-foreground">Adicionar nova capa</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            placeholder="https://..."
            value={newUrl}
            onChange={(e) => {
              setNewUrl(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleAdd()
              }
            }}
            className="flex-1"
          />
          <select
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            className="rounded border bg-background px-2 text-xs uppercase tracking-wide sm:w-40"
          >
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {PLATFORM_LABELS[opt] ?? opt}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={handleAdd} className="gap-1">
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}
