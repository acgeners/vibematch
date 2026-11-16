import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { describeExplanation } from "@/lib/calculations/expected-explanation"
import type { ExpectedExplanationPayload } from "@/lib/calculations/expected-explanation"

/**
 * "Por que esta nota?" — a justificativa da Nota Prevista, na página da obra.
 *
 * Cada linha é uma parcela da conta do modelo (ver `lib/calculations/expected-explanation.ts`):
 * partindo da obra média, cada grupo de entradas soma ou tira, e o ajuste manual entra por cima. Não
 * há texto de IA aqui, de propósito — a justificativa É a conta, então nunca contradiz o número.
 *
 * ⚠️ Recolhido por padrão (`<details>`): é explicação sob demanda, e aberto ele dobraria a altura do
 * card de "Notas calculadas". Funciona sem JS e no toque, ao contrário de um tooltip.
 */

/** Diferença acima da qual a justificativa gravada não é a da nota exibida (gravações de recálculos diferentes). */
export const EXPLANATION_SCORE_TOLERANCE = 0.05

const nf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "+0,41" / "−0,18" / "±0,00" — o sinal sempre impresso, com o menos tipográfico. */
export function formatContribution(n: number): string {
  const abs = nf.format(Math.abs(n))
  if (abs === nf.format(0)) return `±${abs}`
  return `${n > 0 ? "+" : "−"}${abs}`
}

export function ExpectedExplanation({
  payload,
  shownScore,
}: {
  payload: ExpectedExplanationPayload | null
  /** A Nota Prevista que a página está mostrando — a justificativa tem de ser a DELA. */
  shownScore: number | null | undefined
}) {
  if (!payload || shownScore == null) return null
  // Gravada por outro recálculo (ou de outra edição): explicaria um número que não é o da tela.
  if (Math.abs(payload.score - shownScore) > EXPLANATION_SCORE_TOLERANCE) return null
  const view = describeExplanation(payload)
  // Sem nenhuma parcela, a "justificativa" seria só a média do treino — nada a explicar.
  if (view.groups.length === 0 && view.obs === 0) return null

  const gist = view.groups
    .slice(0, 2)
    .map((g) => `${g.label} ${formatContribution(g.delta)}`)
    .join(" · ")

  return (
    <details className="group mb-4 rounded-xl border border-border/80 bg-card/30 px-4 py-3" data-testid="expected-explanation">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-xs font-medium text-foreground">Por que esta nota?</span>
          <span className="block truncate text-[11px] text-muted-foreground">{gist}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-3 space-y-1.5 text-xs">
        <Row label="Partindo da obra média" value={nf.format(view.base)} muted />
        {view.groups.map((g) => (
          <div key={g.key} className="space-y-0.5">
            <Row label={g.label} value={formatContribution(g.delta)} />
            {g.top.length > 0 && (
              <p className="pl-3 text-[11px] text-muted-foreground">
                {g.top.map((t) => `${t.label} ${formatContribution(t.delta)}`).join(" · ")}
              </p>
            )}
          </div>
        ))}
        {view.obs !== 0 && <Row label="Seu ajuste manual" value={formatContribution(view.obs)} />}
        <div className="border-t border-border/60 pt-1.5">
          <Row label="Nota Prevista" value={nf.format(shownScore)} strong />
        </div>
        {view.clamped && (
          <p className="text-[11px] text-muted-foreground">
            A soma passou do limite da escala (0 a 10), por isso a nota não é exatamente a soma das linhas.
          </p>
        )}
        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
          Cada linha compara esta obra com a obra média: + puxa a nota para cima, − para baixo, e somadas
          dão a nota. Por isso algo ruim pode aparecer com +: &quot;Tags que você evita +0,06&quot; quer dizer
          que ela tem menos dessas tags que a média. Os nomes em cada grupo são as entradas que mais
          pesaram; leia o total do grupo, porque o modelo reparte o efeito entre entradas parecidas.
        </p>
      </div>
    </details>
  )
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn(muted ? "text-muted-foreground" : "text-foreground", strong && "font-semibold")}>{label}</span>
      <span className={cn("font-mono tabular-nums", muted ? "text-muted-foreground" : "text-foreground", strong && "font-semibold")}>
        {value}
      </span>
    </div>
  )
}
