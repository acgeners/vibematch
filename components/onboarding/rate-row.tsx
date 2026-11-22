"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PERSONAL_STATUSES_BY_ID, PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { asksChapter, RATE_MENU_STATUSES, rateLock, WANT_TO_READ_STATUS } from "@/lib/onboarding/rate-status"
import type { RateListWork } from "@/lib/onboarding/rate-status"
import { cn, titleToSlug } from "@/lib/utils"
import type { PersonalStatus } from "@/types/domain"
import s from "./onboarding.module.css"

/** 1 a 10, a escala do MyAnimeList: com só os pares, quem pensa "7" tinha que escolher entre 6 e 8. */
const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const STATUS_INFO_BY_NAME = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info]),
)

/** Etiqueta ao lado do status: de onde a obra veio. */
export type RateRowBadge = { kind: "source"; label: string } | { kind: "fresh"; label: string }

/**
 * Uma obra da tela de notas (boas-vindas e "Dar notas"): o status de leitura GRAVADO, com o selo e
 * o menu do resto do site; o capítulo nos status que acompanham progresso; a nota de 0 a 10, que
 * trava pela mesma regra do servidor; e a lixeira, no canto do CARD: ao lado da escala ela lia como
 * "apagar a nota", e o que ela tira é a obra da lista.
 */
export function RateRow({
  work,
  status,
  chapters,
  score,
  badge = null,
  onRate,
  onStatus,
  onChapters,
  onTrash,
}: {
  work: RateListWork
  status: PersonalStatus
  chapters: number | null
  score: number | undefined
  badge?: RateRowBadge | null
  onRate: (value: number) => void
  onStatus: (status: PersonalStatus) => void
  onChapters: (chapters: number | null) => void
  onTrash: () => void
}) {
  // O campo de capítulo é rascunho enquanto se digita (a trava acompanha na hora); grava ao sair dele.
  const [draft, setDraft] = useState(chapters == null ? "" : String(chapters))
  const [synced, setSynced] = useState(chapters)
  // O capítulo muda por fora (Finished = a obra inteira): o rascunho acompanha. Ajuste durante o
  // render, semeado com o valor inicial, para não disparar na hidratação.
  if (chapters !== synced) {
    setSynced(chapters)
    setDraft(chapters == null ? "" : String(chapters))
  }
  const typed = draft.trim() === "" ? null : Number.parseInt(draft, 10)
  const typedChapters = typed != null && Number.isFinite(typed) && typed >= 0 ? typed : null
  const withChapter = asksChapter(status)
  const lock = rateLock(status, withChapter ? typedChapters : chapters, work.totalChapters)
  const shown = lock.locked ? undefined : score
  // Status de publicação na linha dos gêneros (mockup de 22/11/2026). "Unknown" não diz nada: fica de fora.
  const pubInfo = work.publicationStatusId != null ? PUBLICATION_STATUSES_BY_ID[work.publicationStatusId] : undefined
  const pub = pubInfo && pubInfo.slug !== "unknown" ? pubInfo : null
  const commitChapters = () => {
    if (typedChapters !== chapters) onChapters(typedChapters)
  }

  return (
    <div className={s.row}>
      <span className={s.thumb}>
        {work.coverUrls.length > 0 && <CoverImage urls={work.coverUrls} className="size-full object-cover" />}
      </span>
      <span className={s.name}>
        {/* Outra aba: aqui a nota fica na tela (boas-vindas no meio do fluxo, "Dar notas" com o deck). */}
        <a
          href={`/catalog/${titleToSlug(work.title)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={s.nameTitle}
          title="Abrir a página da obra em outra aba"
        >
          {work.title}
        </a>
        {(work.genres.length > 0 || pub) && (
          <span className={s.nameGenres}>
            {work.genres.length > 0 && <span>{work.genres.slice(0, 3).join(" · ")}</span>}
            {/* Texto, não selo: ao lado do selo de status ele disputaria com o que é seu. */}
            {pub && (
              <span className={s.pub}>
                <i aria-hidden="true" style={{ background: pub.color }} />
                {pub.status}
              </span>
            )}
          </span>
        )}
        <span className={s.meta}>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={s.statusTrigger}
              aria-label={`Status de leitura de ${work.title}: ${status}. Mudar`}
            >
              <PersonalStatusBadge status={status} />
              <ChevronDown aria-hidden className={s.statusChevron} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {RATE_MENU_STATUSES.map((name) => {
                const info = STATUS_INFO_BY_NAME[name]
                const active = name === status
                return (
                  <DropdownMenuItem
                    key={name}
                    onSelect={() => onStatus(name)}
                    className={cn("gap-2", active && "bg-primary/10 font-semibold")}
                    title={info?.descriptionPt ?? undefined}
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: info?.color ?? "var(--muted-foreground)" }}
                    />
                    <span aria-hidden className="w-4 shrink-0 text-center">
                      {info?.symbol}
                    </span>
                    <span className="min-w-0 truncate">{name}</span>
                    {active && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal leading-snug text-muted-foreground">
                {WANT_TO_READ_STATUS} tira a obra desta lista.
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>
          {withChapter && (
            <label className={s.chapter}>
              cap.
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={work.totalChapters ?? undefined}
                value={draft}
                aria-label={`Capítulo em que parou em ${work.title}`}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitChapters}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitChapters()
                }}
              />
              {work.totalChapters != null && <>de {work.totalChapters}</>}
            </label>
          )}
          {badge && <span className={badge.kind === "fresh" ? s.fresh : s.source}>{badge.label}</span>}
        </span>
        {lock.text && <span className={s.lock}>{lock.text}</span>}
      </span>
      <span className={s.scale} role="group" aria-label={`Nota para ${work.title}`}>
        {SCALE.map((v) => (
          <button
            key={v}
            type="button"
            className={shown === v ? s.scaleOn : shown != null && v < shown ? s.scaleFill : undefined}
            aria-pressed={shown === v}
            aria-disabled={lock.locked || undefined}
            onClick={() => !lock.locked && onRate(v)}
          >
            {v}
          </button>
        ))}
      </span>
      <button
        type="button"
        className={s.trash}
        onClick={onTrash}
        aria-label={`Tirar ${work.title} desta lista`}
        title="Tirar a obra desta lista"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  )
}
