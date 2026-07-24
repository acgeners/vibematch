"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Archive, ChevronLeft, ChevronRight, ImageIcon, Plus, RotateCcw, Star, Trash2, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { SMALL_COVER_WIDTH } from "@/lib/cover-quality"
import { normalizeCoverSource } from "@/lib/utils"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import {
  addCover,
  archiveCover,
  restoreCover,
  setCoverSource,
  setPrimaryCover,
} from "@/lib/cover-entries"
import type { ArchivedCoverEntry, CoverEntry, CoverLists } from "@/lib/cover-entries"

interface AdvancedContentProps {
  covers: CoverEntry[]
  archived: ArchivedCoverEntry[]
  onChange: (lists: CoverLists) => void
  /** Dimensões já medidas na grade compacta — evita remedir o que já foi visto. */
  dims: Record<string, { w: number; h: number }>
  onDims: (url: string, img: HTMLImageElement | null) => void
  onClose: () => void
}

interface CoversAdvancedDialogProps extends Omit<AdvancedContentProps, "onClose"> {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Item {
  url: string
  source: string
  isPrimary: boolean
  isArchived: boolean
}

/** `undoUrl`: com as arquivadas ocultas, a capa some da tira ao ser arquivada —
 *  o desfazer imediato é o que evita ter que ir procurá-la pra corrigir um clique. */
interface Feedback {
  kind: "ok" | "error"
  text: string
  undoUrl?: string
}

const sourceLabel = (s: string) => PLATFORM_LABELS[s] ?? (s || "sem fonte")

export function CoversAdvancedDialog({ open, onOpenChange, ...rest }: CoversAdvancedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-fit max-w-[96vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[96vw]"
        overlayClassName="bg-black/75 backdrop-blur-[8px]"
      >
        <DialogTitle className="sr-only">Capas — modo avançado</DialogTitle>
        {/* O conteúdo só MONTA com o diálogo aberto: assim a capa selecionada nasce
            no valor certo (`useState` com inicializador) em vez de ser corrigida por
            um efeito depois do primeiro render — que era um setState síncrono dentro
            de efeito, ou seja, um render a mais e um piscar na capa errada. */}
        {open && <AdvancedContent {...rest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function AdvancedContent({
  covers,
  archived,
  onChange,
  dims,
  onDims,
  onClose,
}: AdvancedContentProps) {
  // Selecionada por URL, NÃO por índice: arquivar move a capa pro fim da lista,
  // e um índice fixo passaria a apontar pra outra capa bem no momento em que
  // você quer conferir (ou desfazer) o que acabou de fazer.
  // Começa na primária — é a que você quase sempre abre pra conferir.
  const [activeUrl, setActiveUrl] = useState<string | null>(
    () => covers.find((c) => c.isPrimary)?.url ?? covers[0]?.url ?? archived[0]?.url ?? null,
  )
  const [newUrl, setNewUrl] = useState("")
  const [newSource, setNewSource] = useState("")
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set())
  // Arquivada é capa que você JÁ descartou: ficar na tira é ruído em cima do que
  // ainda está em jogo. Escondidas por padrão, atrás do botão "Arquivadas (N)" —
  // sem ele, restaurar só seria possível saindo daqui. A exceção é a obra sem
  // NENHUMA capa ativa: esconder ali deixaria o diálogo vazio e sem saída.
  const [showArchived, setShowArchived] = useState(
    () => covers.length === 0 && archived.length > 0,
  )
  const railRef = useRef<HTMLDivElement | null>(null)
  // Depois de adicionar, o foco fica no botão — colar a próxima URL exigiria um
  // clique a mais. Devolver o foco ao campo é o que torna a inclusão em série fluida.
  const newUrlRef = useRef<HTMLInputElement>(null)

  const items: Item[] = useMemo(
    () => [
      ...covers.map((c) => ({ ...c, isArchived: false })),
      ...(showArchived
        ? archived.map((a) => ({
            url: a.url,
            source: a.source ?? "",
            isPrimary: false,
            isArchived: true,
          }))
        : []),
    ],
    [covers, archived, showArchived],
  )

  const index = Math.max(0, items.findIndex((i) => i.url === activeUrl))
  const active = items[index] ?? items[0] ?? null

  // A capa de MAIOR largura medida, só entre as ativas — é a que o seletor
  // automático escolheria. Arquivada não concorre.
  const widestUrl = useMemo(() => {
    let best: { url: string; w: number } | null = null
    for (const c of covers) {
      const d = dims[c.url]
      if (!d) continue
      if (!best || d.w > best.w) best = { url: c.url, w: d.w }
    }
    return best?.url ?? null
  }, [covers, dims])

  const go = (delta: number) => {
    if (items.length === 0) return
    const next = items[(index + delta + items.length) % items.length]
    setActiveUrl(next.url)
  }

  // Setas do teclado. Esc e clique-fora já vêm do Radix.
  useEffect(() => {
    if (items.length < 2) return
    const onKey = (e: KeyboardEvent) => {
      // Não sequestrar as setas de quem está digitando a URL/fonte.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        go(-1)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        go(1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, index])

  // Navegar pelas setas pode levar a uma miniatura fora da parte visível da tira.
  useEffect(() => {
    railRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
      inline: "center",
    })
  }, [index])

  if (!active) return null

  const markFailed = (url: string) =>
    setFailedUrls((prev) => (prev.has(url) ? prev : new Set(prev).add(url)))

  const apply = (lists: CoverLists) => onChange(lists)
  const lists: CoverLists = { covers, archived }
  const activeDims = dims[active.url]
  const isSmall = activeDims != null && activeDims.w < SMALL_COVER_WIDTH

  /**
   * Recebe a URL: arquivar vem tanto da barra (capa aberta) quanto da lixeira de
   * QUALQUER miniatura. Só mexe na seleção quando a capa arquivada é a que está
   * no palco — arquivar uma vizinha não deve tirar você de onde estava.
   */
  const handleArchive = (url: string) => {
    if (!showArchived && url === active.url) {
      // Com as arquivadas ocultas a capa some da tira agora: escolhe explicitamente
      // a vizinha em vez de deixar o índice inválido cair na primeira da lista.
      const at = covers.findIndex((c) => c.url === url)
      const remaining = covers.filter((c) => c.url !== url)
      // Era a ÚLTIMA ativa: esconder deixaria o palco vazio — revela o arquivo.
      if (remaining.length === 0) setShowArchived(true)
      else setActiveUrl(remaining[Math.min(Math.max(at, 0), remaining.length - 1)].url)
    }
    apply(archiveCover(lists, url))
    setFeedback({ kind: "ok", text: "Arquivada. Não volta num “Atualizar dados”.", undoUrl: url })
  }
  const handleRestore = (url: string) => {
    apply(restoreCover(lists, url))
    setActiveUrl(url)
    setFeedback({ kind: "ok", text: "Restaurada." })
  }
  const toggleArchived = () => {
    setShowArchived((current) => {
      // Ao esconder de novo, a capa aberta pode ser justamente uma arquivada.
      if (current && active.isArchived) setActiveUrl(covers[0]?.url ?? null)
      return !current
    })
  }
  const handleAdd = () => {
    const result = addCover(lists, newUrl, newSource)
    // Volta o foco nos DOIS caminhos: no erro é onde você corrige, no acerto é
    // onde você cola a próxima.
    newUrlRef.current?.focus()
    if (!result.ok) {
      setFeedback({ kind: "error", text: result.error })
      return
    }
    apply(result.lists)
    setActiveUrl(result.added.url)
    setNewUrl("")
    setNewSource("")
    setFeedback({ kind: "ok", text: `Capa adicionada (${result.added.source}).` })
  }

  const activeCount = covers.length
  const archivedCount = archived.length

  // Moldura de altura FIXA: a imagem se encaixa nela em vez de ditá-la. Sem isso,
  // cada capa de proporção diferente redimensiona o diálogo e a barra de ações
  // salta de lugar a cada navegação.
  return (
    <div className="relative flex h-[90vh] w-[min(96vw,940px)] flex-col gap-2.5">
      <div className="flex items-baseline gap-2 pr-10 text-[13px] font-semibold text-white">
        Capas — modo avançado
        <span className="font-normal text-white/60">
          · {activeCount} ativa{activeCount === 1 ? "" : "s"}
          {archivedCount > 0 &&
            ` · ${archivedCount} arquivada${archivedCount === 1 ? "" : "s"}`}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="absolute right-0 top-0 z-10 rounded-full bg-black/55 p-1.5 text-white transition hover:bg-black/80"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Palco */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {failedUrls.has(active.url) ? (
          <div className="flex flex-col items-center gap-2 text-white/60">
            <ImageIcon className="h-10 w-10 opacity-60" />
            <span className="text-xs">imagem indisponível</span>
          </div>
        ) : (
          <div className="relative flex h-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={active.url}
              src={getCoverImageSrc(active.url)}
              alt={`Capa (${sourceLabel(active.source)})`}
              onError={() => markFailed(active.url)}
              onLoad={(e) => onDims(active.url, e.currentTarget)}
              ref={(node) => onDims(active.url, node)}
              className={`max-h-full max-w-full rounded-lg object-contain shadow-2xl ${
                active.isArchived ? "opacity-60 grayscale" : ""
              }`}
            />
            {active.isArchived && (
              <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white">
                <Archive className="h-3.5 w-3.5" />
                Arquivada — não volta no “Atualizar dados”
              </span>
            )}
          </div>
        )}

        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/80"
              aria-label="Capa anterior"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/80"
              aria-label="Próxima capa"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>

      {/* Barra de ações */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/55 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {active.isArchived ? (
            <span className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white">
              {sourceLabel(active.source)}
            </span>
          ) : (
            <input
              type="text"
              value={active.source}
              placeholder="manual"
              aria-label="Fonte da capa"
              onChange={(e) =>
                apply({ ...lists, covers: setCoverSource(covers, active.url, e.target.value) })
              }
              onBlur={(e) =>
                apply({
                  ...lists,
                  covers: setCoverSource(covers, active.url, normalizeCoverSource(e.target.value)),
                })
              }
              className="w-[124px] rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] text-white placeholder:text-white/40"
            />
          )}

          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] tabular-nums ${
              isSmall
                ? "border-red-400/40 bg-red-400/10 text-red-300"
                : "border-white/20 bg-white/10 text-white"
            }`}
            title={
              isSmall
                ? `Menor que ${SMALL_COVER_WIDTH}px de largura — fica serrilhada na página da obra`
                : undefined
            }
          >
            {activeDims ? `${activeDims.w} × ${activeDims.h}` : "medindo…"}
          </span>

          {!active.isArchived && active.url === widestUrl && (
            <span className="rounded-md border border-primary/50 bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
              maior resolução
            </span>
          )}

          <span className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white">
            {index + 1} / {items.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {active.isArchived ? (
            <button
              type="button"
              onClick={() => handleRestore(active.url)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition hover:border-emerald-400/50 hover:bg-emerald-500/25"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => apply({ ...lists, covers: setPrimaryCover(covers, active.url) })}
                disabled={active.isPrimary}
                aria-pressed={active.isPrimary}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition disabled:cursor-default ${
                  active.isPrimary
                    ? "border border-transparent bg-amber-400/90 font-semibold text-amber-950"
                    : "border border-white/20 bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${active.isPrimary ? "fill-current" : ""}`} />
                {active.isPrimary ? "É a principal" : "Definir como principal"}
              </button>
              <button
                type="button"
                onClick={() => handleArchive(active.url)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition hover:border-red-400/50 hover:bg-red-500/25"
              >
                <Archive className="h-3.5 w-3.5" />
                Arquivar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tira de miniaturas — pular direto pra uma capa. Arquivadas ficam aqui,
          em cinza: some da grade, mas continua a um clique de voltar. */}
      <div ref={railRef} className="w-full shrink-0 overflow-x-auto pb-1">
        <div className="mx-auto flex w-max gap-2 px-1">
          {items.map((item) => {
            const d = dims[item.url]
            const small = d != null && d.w < SMALL_COVER_WIDTH
            const isActive = item.url === active.url
            const failed = failedUrls.has(item.url)
            return (
              // Wrapper é DIV, não button: a lixeira é um botão irmão do de
              // selecionar — botão dentro de botão é HTML inválido e o clique de
              // dentro dispararia os dois.
              <div key={item.url} className="flex w-[58px] shrink-0 flex-col gap-1">
                <div className="group/thumb relative h-[87px] w-[58px]">
                  <button
                    type="button"
                    data-active={isActive}
                    aria-current={isActive}
                    onClick={() => setActiveUrl(item.url)}
                    title={`${sourceLabel(item.source)}${item.isArchived ? " — arquivada" : ""}`}
                    className={`absolute inset-0 cursor-pointer overflow-hidden rounded ${
                      isActive ? "ring-2 ring-white" : "ring-1 ring-white/25 hover:ring-white/60"
                    }`}
                  >
                    {failed ? (
                      <span className="grid h-full w-full place-items-center bg-white/5 text-white/40">
                        <ImageIcon className="h-4 w-4" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getCoverImageSrc(item.url)}
                        alt=""
                        onError={() => markFailed(item.url)}
                        onLoad={(e) => onDims(item.url, e.currentTarget)}
                        ref={(node) => onDims(item.url, node)}
                        className={`h-full w-full object-cover ${
                          item.isArchived ? "opacity-45 grayscale" : ""
                        }`}
                      />
                    )}
                    <span
                      className={`absolute left-0.5 top-0.5 rounded px-1 text-[8px] font-bold leading-normal ${
                        item.isArchived
                          ? "bg-neutral-800 text-neutral-300"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      {item.isArchived ? "🗄" : "✓"}
                    </span>
                    {item.isPrimary && (
                      <span className="absolute right-0.5 top-0.5 rounded bg-amber-400 px-1 text-[8px] font-bold leading-normal text-amber-950">
                        P
                      </span>
                    )}
                  </button>

                  {/* Ação na PRÓPRIA miniatura: arquivar sem antes ter que abrir a
                      capa no palco. Aparece no hover/foco pra não poluir 20+ itens
                      — mesmo padrão do seletor de capas do "Buscar dados". */}
                  <button
                    type="button"
                    onClick={() =>
                      item.isArchived ? handleRestore(item.url) : handleArchive(item.url)
                    }
                    aria-label={item.isArchived ? "Restaurar capa" : "Arquivar capa"}
                    title={item.isArchived ? "Restaurar" : "Arquivar"}
                    className={`absolute bottom-0.5 right-0.5 z-10 rounded bg-black/65 p-0.5 text-white opacity-0 transition-opacity group-hover/thumb:opacity-100 focus:opacity-100 focus-visible:opacity-100 ${
                      item.isArchived ? "hover:bg-emerald-600" : "hover:bg-destructive"
                    }`}
                  >
                    {item.isArchived ? (
                      <RotateCcw className="h-3 w-3" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </button>
                </div>
                <span
                  className={`text-center text-[9px] tabular-nums ${
                    item.isArchived
                      ? "text-white/35"
                      : item.url === widestUrl
                        ? "font-bold text-primary"
                        : small
                          ? "text-red-400"
                          : "text-white/60"
                  }`}
                >
                  {d ? `${d.w}×${d.h}` : "—"}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Adicionar por link */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label htmlFor="adv-cover-url" className="text-xs text-white/70">
          Adicionar por link
        </label>
        <input
          id="adv-cover-url"
          ref={newUrlRef}
          type="url"
          placeholder="https://..."
          value={newUrl}
          onChange={(e) => {
            setNewUrl(e.target.value)
            if (feedback?.kind === "error") setFeedback(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              // O <form> da edição dá `blur()` em qualquer Enter (work-form.tsx:
              // handleFormKeyDown). O portal do Radix não protege: evento de React
              // borbulha pela árvore de COMPONENTES, não pela do DOM — e este
              // diálogo é filho do formulário. Sem parar aqui, o foco ia embora.
              e.stopPropagation()
              handleAdd()
            }
          }}
          className="h-8 min-w-[180px] flex-1 rounded-md border border-white/20 bg-white/10 px-2.5 text-xs text-white placeholder:text-white/40"
        />
        <input
          type="text"
          placeholder="fonte (manual)"
          aria-label="Fonte da nova capa"
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              e.stopPropagation() // idem: o blur global do <form> comeria o foco
              handleAdd()
            }
          }}
          className="h-8 w-[130px] rounded-md border border-white/20 bg-white/10 px-2.5 text-xs text-white placeholder:text-white/40"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/20 bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </button>
        {archived.length > 0 && (
          <button
            type="button"
            onClick={toggleArchived}
            aria-pressed={showArchived}
            disabled={covers.length === 0}
            title={
              covers.length === 0
                ? "Não há capa ativa — esconder as arquivadas deixaria a tira vazia"
                : showArchived
                  ? "Esconder as arquivadas da tira"
                  : "Mostrar as arquivadas na tira, pra restaurar"
            }
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              showArchived
                ? "border-white/40 bg-white/25 text-white"
                : "border-white/20 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            }`}
          >
            <Archive className="h-3.5 w-3.5" />
            Arquivadas ({archived.length})
          </button>
        )}

        {feedback && (
          <span
            className={`flex items-center gap-2 text-xs ${
              feedback.kind === "error" ? "text-red-300" : "text-emerald-300"
            }`}
          >
            {feedback.text}
            {feedback.undoUrl && (
              <button
                type="button"
                onClick={() => handleRestore(feedback.undoUrl as string)}
                className="rounded border border-emerald-300/40 px-1.5 py-0.5 font-medium text-emerald-200 transition hover:bg-emerald-400/20"
              >
                Desfazer
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
