"use client"

import { useState } from "react"
import { CoverImage } from "@/components/ui/cover-image"
import { readingLock } from "@/lib/onboarding/reading-lock"
import type { ReadingKind } from "@/lib/onboarding/reading-lock"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import s from "./onboarding.module.css"

const SCALE = [0, 2, 4, 6, 8, 10]

/** Etiqueta ao lado do seletor: de onde a obra veio. */
export type RateRowBadge = { kind: "source"; label: string } | { kind: "fresh"; label: string }

/**
 * Uma obra da tela de notas (boas-vindas e "Dar notas"): como foi a leitura, a nota de 0 a 10 e,
 * em "Estou lendo", o capítulo. "Terminei" vem marcado, então quem terminou não clica nada a mais;
 * "Remover" tira a obra (o "Já li" errado de qualquer carta, não só da última).
 */
export function RateRow({
  work,
  score,
  kind,
  chapters,
  badge = null,
  onRate,
  onReading,
  onRemove,
}: {
  work: OnboardingDeckWork
  score: number | undefined
  kind: ReadingKind
  chapters: number | null
  badge?: RateRowBadge | null
  onRate: (value: number) => void
  onReading: (kind: ReadingKind, chapters: number | null) => void
  onRemove: () => void
}) {
  // O campo de capítulo é rascunho enquanto se digita (a trava acompanha na hora); grava ao sair dele.
  const [draft, setDraft] = useState(chapters == null ? "" : String(chapters))
  const typed = draft.trim() === "" ? null : Number.parseInt(draft, 10)
  const typedChapters = typed != null && Number.isFinite(typed) && typed >= 0 ? typed : null
  const lock = readingLock(kind, kind === "lendo" ? typedChapters : null, work.totalChapters)
  const shown = lock.locked ? undefined : score
  const commitChapters = () => {
    if (typedChapters !== chapters) onReading("lendo", typedChapters)
  }

  return (
    <div className={s.row}>
      <span className={s.thumb}>
        {work.coverUrls.length > 0 && <CoverImage urls={work.coverUrls} className="size-full object-cover" />}
      </span>
      <span className={s.name}>
        <span className={s.nameTitle}>{work.title}</span>
        {work.genres.length > 0 && <span className={s.nameGenres}>{work.genres.slice(0, 3).join(" · ")}</span>}
        <span className={s.meta}>
          <select
            className={s.select}
            aria-label={`Como foi a leitura de ${work.title}`}
            value={kind}
            onChange={(e) => {
              const v = e.target.value
              if (v === "remover") onRemove()
              else onReading(v as ReadingKind, v === "lendo" ? typedChapters : null)
            }}
          >
            <option value="terminei">Terminei</option>
            <option value="larguei">Larguei</option>
            <option value="lendo">Estou lendo</option>
            <option value="remover">Remover</option>
          </select>
          {kind === "lendo" && (
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
    </div>
  )
}
