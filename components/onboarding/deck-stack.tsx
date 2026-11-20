"use client"

import { useState } from "react"
import { CoverImage } from "@/components/ui/cover-image"
import { formatVotesShort } from "@/lib/ranking/bussola-map"
import type { OnboardingDeckWork } from "@/server/queries/onboarding-deck"
import s from "./onboarding.module.css"

export type SwipeKind = "love" | "dismiss" | "read"

/** A saída do cartão, na direção do botão (← dispensar, ↓ já li, → quero ler). */
export const SWIPE_OUT_CLASS: Record<SwipeKind, string> = {
  love: s.outLove,
  dismiss: s.outNo,
  read: s.outRead,
}
const STAMP: Record<SwipeKind, { text: string; className: string }> = {
  love: { text: "quero ler", className: s.stampLove },
  dismiss: { text: "dispensar", className: s.stampNo },
  read: { text: "já li", className: s.stampRead },
}

const fmtNota = (n: number) => n.toFixed(1).replace(".", ",")

/**
 * A pilha do deck: o cartão da frente e as duas capas de trás. Comum às boas-vindas e à página
 * "Dar notas" — as duas oferecem o mesmo deck, e o deck é um só no código.
 */
export function DeckStack({
  current,
  behind,
  outClass = "",
  stamp = null,
  titleAs = "h2",
}: {
  current: OnboardingDeckWork
  /** As duas de trás, a mais funda primeiro. */
  behind: (OnboardingDeckWork | undefined)[]
  outClass?: string
  stamp?: { kind: SwipeKind; key: number } | null
  /** Nível do título do cartão: depende de onde a pilha mora na página. */
  titleAs?: "h2" | "h3"
}) {
  return (
    <div className={s.stack}>
      {behind.map((w, i) =>
        w ? (
          <span key={w.id} className={`${s.behind} ${i === 0 ? s.behind1 : s.behind2}`} aria-hidden="true">
            {w.coverUrls.length > 0 && <CoverImage urls={w.coverUrls} className="size-full object-cover" />}
          </span>
        ) : null,
      )}
      {stamp && (
        <span key={stamp.key} className={`${s.stamp} ${STAMP[stamp.kind].className}`}>
          {STAMP[stamp.kind].text}
        </span>
      )}
      {/* `key`: obra nova nasce com a sinopse fechada. */}
      <DeckCard key={current.id} work={current} outClass={outClass} titleAs={titleAs} />
    </div>
  )
}

function DeckCard({
  work,
  outClass,
  titleAs: Title,
}: {
  work: OnboardingDeckWork
  outClass: string
  titleAs: "h2" | "h3"
}) {
  const [open, setOpen] = useState(false)
  const votes = work.totalVotes != null && work.totalVotes > 0 ? formatVotesShort(work.totalVotes) : null
  const genres = work.genres.slice(0, 3)
  const synId = `deck-syn-${work.id}`
  return (
    <article className={`${s.card} ${outClass}`}>
      <div className={s.art}>
        {/* `urls` (a lista): o CoverImage cai na próxima candidata quando uma morre. `eager`: o
            cartão da frente nunca espera a rolagem. */}
        {work.coverUrls.length > 0 && (
          <CoverImage urls={work.coverUrls} alt={`Capa de ${work.title}`} className="size-full object-cover" loading="eager" />
        )}
      </div>
      <div className={s.shade} />
      {work.platformAvg != null && (
        <span className={s.badge}>
          ★ {fmtNota(work.platformAvg)}
          {votes && <small> · {votes} votos</small>}
        </span>
      )}
      <div className={s.body}>
        <Title className={s.title}>{work.title}</Title>
        <div className={s.tags}>
          {genres.map((g) => (
            <span key={g} className={s.tag}>
              {g}
            </span>
          ))}
        </div>
        <p className={s.syn}>{work.synopsis}</p>
      </div>
      {open && (
        <div className={s.synOpen} id={synId}>
          <p className={s.synOpenTitle} aria-hidden="true">
            {work.title}
          </p>
          <div className={s.synOpenMeta}>
            {work.platformAvg != null && (
              <span style={{ marginRight: 4 }}>
                ★ {fmtNota(work.platformAvg)}
                {votes && <span style={{ color: "#9fb0c8" }}> · {votes} votos</span>}
              </span>
            )}
            {genres.map((g) => (
              <span key={g} className={s.tag}>
                {g}
              </span>
            ))}
          </div>
          <div className={s.synOpenRule} aria-hidden="true" />
          {/* `data-keys-own`: com o foco aqui, as setas rolam o texto em vez de marcar a obra. */}
          <p className={s.synOpenText} tabIndex={0} data-keys-own="">
            {work.synopsis}
          </p>
        </div>
      )}
      {/* Fechado: seta para BAIXO (é a que diz "abrir mais"); aberto: ✕. No mesmo canto nos dois. */}
      <button
        type="button"
        className={s.synToggle}
        aria-expanded={open}
        aria-controls={open ? synId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Fechar" : "Sinopse completa"}
        {open ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
    </article>
  )
}
