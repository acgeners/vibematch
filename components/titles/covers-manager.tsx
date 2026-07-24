"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Archive, ChevronRight, ImageIcon, Maximize2, Plus, RotateCcw, Star, Trash2, ZoomIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { SMALL_COVER_WIDTH } from "@/lib/cover-quality"
import { normalizeCoverSource } from "@/lib/utils"
import { CoversAdvancedDialog } from "@/components/titles/covers-advanced-dialog"
import { addCover, archiveCover, restoreCover, setPrimaryCover } from "@/lib/cover-entries"
import type { ArchivedCoverEntry, CoverEntry, CoverLists } from "@/lib/cover-entries"

// Reexportados: o tipo agora mora em `lib/cover-entries` (a grade e o diálogo
// avançado compartilham as mesmas regras), mas quem importava daqui continua valendo.
export type { CoverEntry, ArchivedCoverEntry }

interface CoversManagerProps {
  value: CoverEntry[]
  onChange: (next: CoverEntry[]) => void
  /** Capas apagadas que NÃO devem voltar num "Atualizar dados" (migration 163). */
  archived?: ArchivedCoverEntry[]
  onArchivedChange?: (next: ArchivedCoverEntry[]) => void
}

export function CoversManager({
  value,
  onChange,
  archived = [],
  onArchivedChange,
}: CoversManagerProps) {
  const [newUrl, setNewUrl] = useState("")
  const [newSource, setNewSource] = useState<string>("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addedNotice, setAddedNotice] = useState<string | null>(null)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)
  /** Capa aberta em tamanho grande (lightbox). `null` = fechado. */
  const [preview, setPreview] = useState<{ url: string; source: string } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // O foco volta pro campo de URL depois de cada inclusão: sem isso ele fica no
  // botão, e colar a próxima capa exige um clique a mais. Faz par com o form
  // continuar aberto — os dois existem pra você adicionar várias em sequência.
  const newUrlRef = useRef<HTMLInputElement>(null)
  // Enquanto o campo está em foco vale o texto cru — normalizar a cada tecla
  // faria o cursor pular no meio da digitação. O valor salvo é o normalizado.
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({})
  // Escolher a primária às cegas erra: medindo o catálogo, a ordem por
  // prioridade de fonte pegava a melhor capa em só 32% das obras com 2+ capas.
  // O tamanho vem do próprio `img` que já está na tela — sem requisição extra.
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({})

  // Esc fecha o lightbox. Só monta o listener enquanto ele está aberto.
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [preview])

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

  const lists: CoverLists = { covers: value, archived }

  /**
   * Um ponto ÚNICO de escrita das duas listas. As transições vivem em
   * `lib/cover-entries` porque a grade e o diálogo avançado editam a mesma capa:
   * regras duplicadas divergiriam em silêncio — arquivar por um caminho e não
   * pelo outro é exatamente o bug que a tabela de arquivadas existe pra impedir.
   */
  const applyLists = (next: CoverLists) => {
    if (next.covers !== value) onChange(next.covers)
    if (next.archived !== archived) onArchivedChange?.(next.archived)
  }

  const handleAdd = () => {
    const result = addCover(lists, newUrl, newSource)
    // O foco volta pro campo de URL nos DOIS caminhos: no erro é onde você vai
    // corrigir, no acerto é onde você cola a próxima.
    newUrlRef.current?.focus()
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    applyLists(result.lists)
    setNewUrl("")
    setNewSource("")
    setAddedNotice(`Capa adicionada (${result.added.source}).`)
    // O formulário PERMANECE aberto — fechar depois de cada inclusão obrigava a
    // reabrir pra cada capa. Só o botão "Ocultar" fecha.
  }

  const handleDelete = (url: string) => {
    if (!onArchivedChange) {
      // Sem o canal de arquivadas (uso legado do componente), apagar é só remover.
      onChange(value.filter((c) => c.url !== url))
      return
    }
    applyLists(archiveCover(lists, url))
    setShowArchived(true)
  }

  const handleRestore = (url: string) => applyLists(restoreCover(lists, url))

  const handleSetPrimary = (url: string) => onChange(setPrimaryCover(value, url))

  const handleSourceChange = (url: string, source: string) => {
    onChange(value.map((c) => (c.url === url ? { ...c, source } : c)))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Capas ({value.length})</Label>
          <p className="text-xs text-muted-foreground">
            Clique na imagem para ampliar. A <Star className="inline h-3 w-3 -translate-y-px fill-amber-400 text-amber-400" /> define qual aparece nos cards.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* A grade é boa pra ver tudo de relance; o avançado é pra DECIDIR capa a
              capa, com a imagem grande. As duas escrevem no mesmo estado. */}
          {(value.length > 0 || archived.length > 0) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdvancedOpen(true)}
              className="h-8 gap-1 px-2.5"
              title="Abrir a galeria em tela cheia, com setas e ações por capa"
            >
              <Maximize2 className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:text-xs">Avançado</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowAddForm((current) => !current)
              setError(null)
              setAddedNotice(null)
            }}
            className="h-8 gap-1 px-2.5"
            aria-expanded={showAddForm}
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:text-xs">
              {showAddForm ? "Ocultar" : "Adicionar"}
            </span>
          </Button>
        </div>
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
                    <button
                      type="button"
                      onClick={() => setPreview({ url: cover.url, source: cover.source })}
                      className="group relative block h-full w-full cursor-zoom-in"
                      aria-label={`Ampliar capa (${cover.source})`}
                      title="Ampliar"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageSrc}
                        alt={`Capa (${cover.source})`}
                        className="h-full w-full object-cover"
                        onError={() => markFailed(imageSrc)}
                        onLoad={(e) => recordDims(cover.url, e.currentTarget)}
                        ref={(node) => recordDims(cover.url, node)}
                      />
                      <span className="pointer-events-none absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        <ZoomIn className="h-3.5 w-3.5" />
                      </span>
                      {/* Dimensões SOBRE a arte: com 3 colunas o card tem ~98px, e
                          disputar essa largura com os dois botões quebrava
                          "1199 × 1719" em duas linhas. O span fica DENTRO do botão,
                          então clicar nele ainda amplia — e o `title` sobrevive. */}
                      {(() => {
                        const d = dims[cover.url]
                        if (!d) return null
                        const isSmall = d.w < SMALL_COVER_WIDTH
                        return (
                          <span
                            className={`absolute bottom-1 left-1 rounded bg-black/65 px-1 py-px text-[9px] tabular-nums leading-tight ${
                              isSmall ? "text-red-400" : "text-white/85"
                            }`}
                            title={
                              isSmall
                                ? `Menor que ${SMALL_COVER_WIDTH}px de largura — fica serrilhada na página da obra`
                                : undefined
                            }
                          >
                            {d.w} × {d.h}
                          </span>
                        )
                      })()}
                    </button>
                  )}
                </div>

                <div className="space-y-1.5 bg-card p-2">
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

                  {/* Só os dois botões: o rótulo "Primária" gastava uma linha
                      inteira por card e as dimensões foram pra cima da arte. */}
                  <div className="flex items-center justify-center gap-1">
                    <span className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => handleSetPrimary(cover.url)}
                        aria-pressed={cover.isPrimary}
                        aria-label={cover.isPrimary ? "Capa principal" : "Definir como capa principal"}
                        title={cover.isPrimary ? "Capa principal" : "Definir como principal"}
                        className={`rounded p-1 hover:bg-muted ${
                          cover.isPrimary
                            ? "text-amber-400"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Star className={`h-4 w-4 ${cover.isPrimary ? "fill-current" : ""}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(cover.url)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label="Arquivar capa"
                        title="Arquivar capa"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {archived.length > 0 && (
        <div className="border-t border-dashed pt-3">
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            aria-expanded={showArchived}
            className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${showArchived ? "rotate-90" : ""}`}
            />
            <Archive className="h-3.5 w-3.5" />
            Arquivadas ({archived.length})
          </button>

          {showArchived && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Não voltam num “Atualizar dados”. Clique em ↺ para restaurar.
              </p>
              <div className="flex flex-wrap gap-2">
                {archived.map((entry) => {
                  const src = getCoverImageSrc(entry.url)
                  const failed = failedUrls.has(src)
                  return (
                    <div
                      key={entry.url}
                      className="w-14 overflow-hidden rounded border opacity-60 transition-opacity hover:opacity-100"
                      title={`${entry.source || "sem fonte"} — arquivada`}
                    >
                      <div className="aspect-[2/3] bg-muted">
                        {failed ? (
                          <div className="grid h-full w-full place-items-center text-muted-foreground">
                            <ImageIcon className="h-4 w-4 opacity-50" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setPreview({ url: entry.url, source: entry.source || "arquivada" })
                            }
                            className="block h-full w-full cursor-zoom-in"
                            aria-label="Ampliar capa arquivada"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt=""
                              className="h-full w-full object-cover"
                              onError={() => markFailed(src)}
                            />
                          </button>
                        )}
                      </div>
                      <div className="flex justify-center bg-card py-0.5">
                        <button
                          type="button"
                          onClick={() => handleRestore(entry.url)}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Restaurar capa"
                          title="Restaurar capa"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
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
              ref={newUrlRef}
              type="url"
              placeholder="https://..."
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value)
                if (error) setError(null)
                if (addedNotice) setAddedNotice(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  // O <form> tem uma regra GLOBAL: Enter em qualquer input valida e
                  // dá `blur()` (work-form.tsx:handleFormKeyDown). Ela roda no
                  // borbulhamento, DEPOIS daqui, e desfazia o foco que acabamos de
                  // devolver. Aqui o Enter significa "adicionar e continuar", não
                  // "terminei este campo" — então ele não sobe.
                  e.stopPropagation()
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
                    e.stopPropagation() // idem: o blur global do <form> comeria o foco
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
          {!error && addedNotice && (
            <p className="text-xs text-emerald-500">{addedNotice} O formulário segue aberto.</p>
          )}
        </div>
      )}

      {/* PORTAL pro <body>: a página de edição tem ancestrais com `filter`/
          `backdrop-filter`, e eles viram bloco de contenção de `position: fixed` —
          sem o portal o lightbox escurecia só o pedaço do formulário, não a tela. */}
      {preview &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            onClick={() => setPreview(null)}
            role="button"
            tabIndex={-1}
            aria-label="Fechar visualização"
          >
            <div className="relative flex max-h-full w-full max-w-md flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getCoverImageSrc(preview.url)}
                alt={`Capa ampliada (${preview.source})`}
                className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
              />
              <p className="text-xs text-white/70">
                {preview.source}
                {dims[preview.url] ? ` · ${dims[preview.url].w} × ${dims[preview.url].h}` : ""}
              </p>
            </div>
          </div>,
          document.body,
        )}

      {/* Modo avançado. `dims` é COMPARTILHADO: as capas que a grade já mediu
          entram no diálogo com o tamanho pronto, sem piscar "medindo…". */}
      <CoversAdvancedDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        covers={value}
        archived={archived}
        onChange={applyLists}
        dims={dims}
        onDims={recordDims}
      />
    </div>
  )
}
