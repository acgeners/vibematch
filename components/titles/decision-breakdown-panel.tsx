"use client"

import type { DecisionBreakdown } from "@/lib/calculations/decision-breakdown"

/**
 * O CORPO do painel que explica a Prioridade — separado do Tooltip de propósito.
 *
 * ⚠️ `TooltipContent` do Radix não abre no jsdom, então um teste que dependesse do
 * hover não veria nada. Com o corpo extraído, o teste RENDERIZA este componente e
 * lê o texto ([[gotcha-radix-tooltip-nao-abre-no-jsdom]]).
 *
 * ⚠️ Tom secundário aqui é `text-background/<alfa>`, nunca `text-muted-foreground`:
 * este bloco vive dentro do `TooltipContent`, que é INVERTIDO (`bg-foreground` +
 * `text-background`). O token de página passa no escuro e cai pra ~3:1 no claro.
 *
 * ⚠️ E o alfa foi MEDIDO no browser, compondo a cor sobre o fundo real do tooltip
 * (2026-08-15): `/70` dá 8,0:1 · `/65` dá 6,6:1 · `/60` dá 5,5:1 — e o `/50` que
 * este arquivo usava dava **3,87:1**, abaixo do AA de 4,5:1 num texto de 12px.
 * 🔴 Contraste de texto com alfa NÃO se lê na cor computada: `getComputedStyle`
 * devolve a cor base, e ignorar o canal alfa dava 18:1 para o mesmo `/50`.
 */
export function DecisionBreakdownPanel({ breakdown }: { breakdown: DecisionBreakdown }) {
  const { total, expected, alignment, alignWeight, insideExpected, weightsNote } = breakdown
  const num = (v: number, casas = 1) => v.toFixed(casas).replace(".", ",")

  if (total == null) {
    return (
      <div className="space-y-1.5 text-xs">
        <p className="font-semibold">Sem Prioridade</p>
        <p className="text-background/70">
          Ela depende da Nota Prevista, que ainda não foi calculada pra esta obra.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 text-xs">
      <p className="font-semibold">Prioridade {num(total)}</p>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-background/70">Nota Prevista (âncora)</span>
          <span className="tabular-nums">{expected == null ? "—" : num(expected)}</span>
        </div>

        {/* Sem veredito, a Prioridade É a Prevista — e dizer isso evita a leitura de
            que "faltou alguma coisa". Com veredito, o peso vem de `decisionAlignWeight`,
            o mesmo que o cálculo aplicou; nunca reescrito aqui. */}
        {alignment == null ? (
          <p className="text-background/60">
            Sem Veredito IA — aqui a Prioridade é igual à Nota Prevista.
          </p>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-background/70">
              Veredito IA <span className="text-background/65">· peso {Math.round(alignWeight * 100)}%</span>
            </span>
            <span className="tabular-nums">{Math.round(alignment)}/100</span>
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-background/20 pt-1.5">
        <p className="text-background/70">
          Já dentro da Nota Prevista, com peso aprendido nas suas notas:
        </p>
        <ul className="space-y-0.5">
          {insideExpected.map((s) => (
            <li key={s.key} className="flex items-baseline justify-between gap-3">
              <span className="text-background/70">{s.label}</span>
              {s.value == null ? (
                <span className="text-background/65 italic">{s.emptyHint}</span>
              ) : (
                <span className="tabular-nums">{s.value}</span>
              )}
            </li>
          ))}
        </ul>
        {/* A frase que impede a conclusão errada ("então a Prioridade ignora isto").
            ⚠️ Ela diz "não melhora", e NÃO "piora": o Δrho de somar os 7 por cima é
            −0,017 com IC95% [−0,050, +0,015] — cruza zero. Afirmar piora aqui seria
            a tela indo além do que a medição sustenta (ver o docstring do módulo). */}
        {/* Frase própria, não sufixo da linha de Atributos: a ênfase é a mesma pra
            todas as obras da comparação. */}
        <p className="text-background/60">{weightsNote}</p>
        <p className="text-background/60">
          Não são somados de novo por cima: re-aplicá-los não melhora a ordem — foi medido.
        </p>
      </div>
    </div>
  )
}
