"use client"

import { useState } from "react"
import { ImageIcon, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PLATFORMS } from "@/types/domain"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { getCoverImageSrc } from "@/lib/image-proxy"

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
  const [showAddForm, setShowAddForm] = useState(false)
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
    setShowAddForm(false)
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
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Capas ({value.length})</Label>
          <p className="text-xs text-muted-foreground">
            Marque <strong>Primária</strong> para definir qual aparece nos cards.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setShowAddForm((current) => !current)
            setError(null)
          }}
          className="h-8 shrink-0 gap-1 px-2.5"
          aria-expanded={showAddForm}
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only sm:text-xs">
            {showAddForm ? "Ocultar" : "Adicionar"}
          </span>
        </Button>
      </div>

      {value.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Nenhuma capa cadastrada. Adicione uma URL abaixo.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((cover) => {
            const imageSrc = getCoverImageSrc(cover.url)
            const failed = failedUrls.has(imageSrc)
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
                      <span className="text-[11px]">indisponível</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageSrc}
                      alt={`Capa (${cover.source})`}
                      className="h-full w-full object-cover"
                      onError={() => markFailed(imageSrc)}
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

      {showAddForm && (
        <div className="space-y-3 rounded-md border border-dashed p-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-cover-url" className="text-xs text-muted-foreground">
              URL da capa
            </Label>
            <Input
              id="new-cover-url"
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
              className="w-full"
              autoFocus
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-xs uppercase tracking-wide"
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
      )}
    </div>
  )
}
