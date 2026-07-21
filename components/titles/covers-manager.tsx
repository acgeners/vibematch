"use client"

import { useState } from "react"
import { ImageIcon, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { SMALL_COVER_WIDTH } from "@/lib/cover-quality"
import { normalizeCoverSource } from "@/lib/utils"

export interface CoverEntry {
  url: string
  source: string
  isPrimary: boolean
}

interface CoversManagerProps {
  value: CoverEntry[]
  onChange: (next: CoverEntry[]) => void
}

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
  const [newSource, setNewSource] = useState<string>("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  // Enquanto o campo está em foco vale o texto cru — normalizar a cada tecla
  // faria o cursor pular no meio da digitação. O valor salvo é o normalizado.
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({})
  // Escolher a primária às cegas erra: medindo o catálogo, a ordem por
  // prioridade de fonte pegava a melhor capa em só 32% das obras com 2+ capas.
  // O tamanho vem do próprio `img` que já está na tela — sem requisição extra.
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({})

  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))

  /**
   * Guarda as dimensões de uma capa já carregada.
   *
   * Chamado do `onLoad` E do `ref`: a imagem vem no HTML do servidor e costuma
   * terminar de carregar ANTES de o React hidratar, e nesse caso o evento `load`
   * já passou — só o `img.complete` no ref pega esse caso (era o que deixava
   * todos os cards em "—").
   */
  const recordDims = (url: string, img: HTMLImageElement | null) => {
    if (!img?.complete || !img.naturalWidth) return
    setDims((prev) =>
      prev[url] ? prev : { ...prev, [url]: { w: img.naturalWidth, h: img.naturalHeight } },
    )
  }

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
      source: normalizeCoverSource(newSource),
      isPrimary: value.length === 0,
    }
    onChange([...value, next])
    setNewUrl("")
    setNewSource("")
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
                      onLoad={(e) => recordDims(cover.url, e.currentTarget)}
                      ref={(node) => recordDims(cover.url, node)}
                    />
                  )}
                </div>

                <div className="space-y-2 bg-card p-2">
                  <input
                    type="text"
                    value={sourceDrafts[cover.url] ?? cover.source}
                    placeholder="manual"
                    aria-label="Fonte da capa"
                    onChange={(e) =>
                      setSourceDrafts((prev) => ({ ...prev, [cover.url]: e.target.value }))
                    }
                    onBlur={() => {
                      const draft = sourceDrafts[cover.url]
                      if (draft !== undefined) handleSourceChange(cover.url, normalizeCoverSource(draft))
                      setSourceDrafts((prev) => {
                        if (!(cover.url in prev)) return prev
                        const rest = { ...prev }
                        delete rest[cover.url]
                        return rest
                      })
                    }}
                    className="block w-full rounded border bg-background px-1.5 py-1 text-[10px] tracking-wide"
                  />

                  {(() => {
                    const d = dims[cover.url]
                    if (failed) return null
                    if (!d) {
                      return (
                        <p className="text-[10px] text-muted-foreground/50" title="Medindo…">
                          —
                        </p>
                      )
                    }
                    const isSmall = d.w < SMALL_COVER_WIDTH
                    return (
                      <p
                        className={`text-[10px] tabular-nums ${
                          isSmall ? "text-destructive" : "text-muted-foreground"
                        }`}
                        title={
                          isSmall
                            ? `Menor que ${SMALL_COVER_WIDTH}px de largura — fica serrilhada na página da obra`
                            : undefined
                        }
                      >
                        {d.w} × {d.h}
                      </p>
                    )
                  })()}

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
          <div className="space-y-1.5">
            <Label htmlFor="new-cover-source" className="text-xs text-muted-foreground">
              Fonte
            </Label>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                id="new-cover-source"
                type="text"
                placeholder="manual"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
                className="w-full"
              />
              <Button type="button" variant="secondary" onClick={handleAdd} className="gap-1">
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>
            {newSource.trim() && normalizeCoverSource(newSource) !== newSource.trim() && (
              <p className="text-[11px] text-muted-foreground">
                Será salva como{" "}
                <span className="font-mono font-medium text-foreground">
                  {normalizeCoverSource(newSource)}
                </span>
              </p>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
