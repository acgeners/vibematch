"use client"

import type { SwipeKind } from "./deck-stack"
import s from "./onboarding.module.css"

/**
 * Os três botões do deck com o MESMO peso — nenhum preenchido, para o botão não sugerir a resposta —,
 * cada um na cor da sua coluna do placar, e o "Desfazer última" embaixo, no centro (decisões de
 * 19/11/2026). As setas lembram o atalho de teclado de cada um.
 */
export function DeckButtons({
  onSwipe,
  onUndo,
  canUndo,
}: {
  onSwipe: (kind: SwipeKind) => void
  onUndo: () => void
  canUndo: boolean
}) {
  return (
    <>
      <div className={s.acts}>
        <button type="button" className={`${s.act} ${s.actNo}`} onClick={() => onSwipe("dismiss")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
          <span className={s.actLabel}>
            Dispensar <span className={s.actKey} aria-hidden="true">←</span>
          </span>
        </button>
        <button type="button" className={`${s.act} ${s.actRead}`} onClick={() => onSwipe("read")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className={s.actLabel}>
            Já li <span className={s.actKey} aria-hidden="true">↓</span>
          </span>
        </button>
        <button type="button" className={`${s.act} ${s.actLove}`} onClick={() => onSwipe("love")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 5.3 3 1.7-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z" />
          </svg>
          <span className={s.actLabel}>
            Quero ler <span className={s.actKey} aria-hidden="true">→</span>
          </span>
        </button>
      </div>
      {/* Apagado (e sem efeito) quando não há o que desfazer; `aria-disabled` e não `disabled` para
          o botão não sair da ordem do Tab e a pessoa achar onde ele mora. */}
      <button type="button" className={s.undo} aria-disabled={!canUndo} onClick={() => canUndo && onUndo()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
        Desfazer última
      </button>
    </>
  )
}
