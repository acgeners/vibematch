"use client"

import { useState } from "react"
import { ENSO_GOAL } from "@/lib/onboarding/enso"
import s from "./onboarding.module.css"

/** Arco do ensō: 270° de um círculo de raio 38 (o círculo aberto da marca). */
const ENSO_ARC = 185.6

/** O anel que enche até as 20 notas. Com `withNumber`, o número fica no meio (o painel grande). */
export function EnsoRing({
  rated,
  size = 150,
  stroke = 6,
  withNumber = false,
}: {
  rated: number
  size?: number
  stroke?: number
  withNumber?: boolean
}) {
  const arc = (Math.min(1, rated / ENSO_GOAL) * ENSO_ARC).toFixed(1)
  const svg = (
    <svg width={size} height={size} viewBox="0 0 90 90" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${ENSO_ARC} 239`} transform="rotate(126 45 45)" />
      <circle className={s.ringArc} cx="45" cy="45" r="38" fill="none" stroke="#8fdbff" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} 239`} transform="rotate(126 45 45)" />
    </svg>
  )
  if (!withNumber) return svg
  return (
    <div className={s.ring}>
      {svg}
      <span className={s.ringNum}>
        <b>{rated}</b>
        <small>de {ENSO_GOAL}</small>
      </span>
    </div>
  )
}

/**
 * "Seu ensō ⓘ": o termo não era explicado em lugar nenhum. O balão abre com hover, com foco e com
 * clique (no celular não há hover). `align="start"` quando o título não está centralizado.
 */
export function EnsoTitle({ align = "center" }: { align?: "center" | "start" }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`${s.ensoTitle} ${align === "start" ? s.tipStart : ""}`}>
      Seu{" "}
      <span className={s.tipWrap} style={{ display: "inline-block" }}>
        <button
          type="button"
          className={s.ensoWord}
          aria-expanded={open}
          aria-describedby="enso-dica"
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setOpen(false)}
        >
          <span>ensō</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fdbff" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ opacity: 0.85 }}>
            <circle cx="12" cy="12" r="9.5" />
            <line x1="12" y1="11" x2="12" y2="16.5" />
            <circle cx="12" cy="7.6" r=".6" fill="#8fdbff" />
          </svg>
        </button>
        <span id="enso-dica" role="tooltip" className={s.tip} data-open={open}>
          No zen, o ensō é o círculo pintado num só traço. Simboliza o satori, o instante em que tudo fica
          claro, e é também a nossa marca.
        </span>
      </span>
    </span>
  )
}
