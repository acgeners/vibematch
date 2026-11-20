"use client"

import { useState } from "react"
import Link from "next/link"
import { EnsoRing, EnsoTitle } from "@/components/onboarding/enso"
import { ENSO_GOAL } from "@/lib/onboarding/enso"
import { buildFirstSteps, FIRST_STEPS_HIDDEN_COOKIE } from "@/lib/onboarding/first-steps"
import type { FirstStepsProgress } from "@/server/queries/onboarding-progress"
import s from "./first-steps-card.module.css"

/** Um ano: "Esconder" é escolha da pessoa, não do dia. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function rememberHidden(hidden: boolean) {
  document.cookie = hidden
    ? `${FIRST_STEPS_HIDDEN_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    : `${FIRST_STEPS_HIDDEN_COOKIE}=; path=/; max-age=0; samesite=lax`
}

/**
 * A PONTE do onboarding na home: 4 passos com o ensō das 20 notas (mockup aprovado em 19/11/2026).
 * Com 20 notas o card dá lugar a um aviso de uma linha; o caller já não renderiza quando tudo está
 * feito. "Esconder" vai num COOKIE: o servidor lê e a página já abre escondida, sem piscar
 * (preferência de tela em `localStorage` quebraria a hidratação — ver o CLAUDE.md).
 */
export function FirstStepsCard({
  progress,
  initiallyHidden = false,
}: {
  progress: FirstStepsProgress
  initiallyHidden?: boolean
}) {
  const [hidden, setHidden] = useState(initiallyHidden)
  const { steps, current, doneCount, predictionOn } = buildFirstSteps(progress)
  const hide = (v: boolean) => {
    setHidden(v)
    rememberHidden(v)
  }

  if (predictionOn) {
    return (
      <div className={`${s.glass} ${s.ready}`}>
        <div className={s.glow} aria-hidden="true" />
        <EnsoRing rated={ENSO_GOAL} size={52} stroke={7} />
        <div className={s.readyText}>
          <div className={s.readyTitle}>A Nota Prevista ligou.</div>
          <div className={s.muted}>
            Com {ENSO_GOAL} notas, o Ranking e o “Pra você hoje” passam a ordenar pelo seu gosto, não pelo
            Alinhamento.
          </div>
        </div>
        <Link href="/ranking" className={s.cta}>
          Ver o ranking →
        </Link>
      </div>
    )
  }

  if (hidden) {
    return (
      <div className={s.hiddenLine}>
        Primeiros passos escondidos.{" "}
        <button type="button" onClick={() => hide(false)}>
          Mostrar de novo
        </button>
      </div>
    )
  }

  return (
    <section aria-label="Primeiros passos" className={`${s.glass} ${s.card}`}>
      <div className={s.glow} aria-hidden="true" />
      <div className={s.head}>
        <div className={s.headTitle}>
          <span className={s.lotus} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 48 48" fill="none">
              <path d="M24 11c3.6 4 4 9.2 0 15.2-4-6-3.6-11.2 0-15.2Z" fill="#8fdbff" />
              <path d="M24 26.2c-5.6-1.7-9.9-.7-12.4 2.9 4.3 2.6 8.6 1.8 12.4-2.9Zm0 0c5.6-1.7 9.9-.7 12.4 2.9-4.3 2.6-8.6 1.8-12.4-2.9Z" fill="#2e7ff0" />
            </svg>
          </span>
          <div>
            <p className={s.eyebrow}>
              {doneCount} de {steps.length} feitos
            </p>
            <h2 className={s.title}>Primeiros passos</h2>
          </div>
        </div>
        <div className={s.headActions}>
          <span className={s.progress} aria-hidden="true">
            {steps.map((st, i) => (
              <span key={st.title} className={i === current ? s.segNow : st.done ? s.segDone : s.seg} />
            ))}
          </span>
          {/* A porta de volta às boas-vindas: sem ela, "Pular por agora" não tinha volta. */}
          <Link href="/welcome" className={s.link}>
            Rever as boas-vindas
          </Link>
          <button type="button" className={s.ghost} onClick={() => hide(true)}>
            Esconder
          </button>
        </div>
      </div>
      <div className={s.body}>
        <div className={s.meter}>
          <EnsoRing rated={progress.ratedCount} size={120} withNumber />
          <div>
            <EnsoTitle align="start" />
            <p className={s.muted}>
              Cada nota fecha um arco. Aos {ENSO_GOAL}, a Nota Prevista liga; até lá, o Alinhamento (as tags que
              você escolheu) ordena suas listas.
            </p>
          </div>
        </div>
        <ol className={s.steps}>
          {steps.map((st, i) => (
            <li key={st.title} className={s.step}>
              {st.done ? (
                <span className={s.mark} aria-label="Feito">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#04101f" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              ) : (
                <span className={i === current ? s.numNow : s.num}>{String(i + 1).padStart(2, "0")}</span>
              )}
              <div className={s.stepText}>
                <div className={st.done ? s.stepTitleDone : s.stepTitle}>{st.title}</div>
                <div className={s.stepSub}>{st.sub}</div>
                {st.importShortcut && (
                  <div className={s.stepSub} style={{ marginTop: 6 }}>
                    Tem lista em outro site?{" "}
                    <Link href="/import" className={s.link}>
                      Importar traz as notas de uma vez
                    </Link>
                  </div>
                )}
              </div>
              {!st.done && st.cta && (
                <Link href={st.cta.href} className={i === current ? s.cta : s.ctaLight}>
                  {st.cta.label} →
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
