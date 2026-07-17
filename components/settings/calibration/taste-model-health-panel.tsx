import Link from "next/link"
import { ChevronRight, Search, Stethoscope } from "lucide-react"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import type {
  TasteCriterionHealth,
  TasteFlag,
  TasteModelHealth,
} from "@/lib/calculations/taste-model-health"

/**
 * "Saúde do modelo de gosto" — diagnóstico só-leitura das VULNERABILIDADES dos
 * pesos aprendidos (declarado × inferido). Mora em "Viés & atributos". Os dados
 * vêm de `getTasteModelHealth` (que lê `score_weights_inferred`); a lógica dos
 * flags é pura (`lib/calculations/taste-model-health.ts`).
 */

const critName = (slug: string) => CRITERIA_INFO[slug as keyof typeof CRITERIA_INFO]?.name ?? slug
const critEmoji = (slug: string) => CRITERIA_INFO[slug as keyof typeof CRITERIA_INFO]?.emoji ?? "•"

/** Peso formatado com sinal e vírgula decimal, sem `.0` supérfluo. */
function fmtWeight(n: number): string {
  const s = Math.abs(n) < 0.05 ? "0" : n.toFixed(1).replace(/[.,]0$/, "").replace(".", ",")
  return n > 0 ? `+${s}` : n < 0 ? `−${s.replace("-", "")}` : s
}

function confBadge(confidence: TasteCriterionHealth["confidence"]) {
  if (confidence === "high") return { label: "conf. alta", cls: "text-emerald-700 ring-emerald-500/30 bg-emerald-500/10 dark:text-emerald-300" }
  if (confidence === "medium") return { label: "conf. média", cls: "text-amber-700 ring-amber-500/30 bg-amber-500/10 dark:text-amber-300" }
  return { label: "conf. baixa", cls: "text-rose-700 ring-rose-500/30 bg-rose-500/10 dark:text-rose-300" }
}

const FLAG_LABEL: Record<TasteFlag["kind"], string> = {
  sign_flip: "sinal invertido",
  unsupported: "peso sem sustentação",
  fragile_bet: "aposta frágil",
}

/** Explicação por flag, ciente da confiança (o mesmo sinal-invertido muda de leitura). */
function explain(c: TasteCriterionHealth): string {
  const declSide = c.currentWeight > 0 ? "positivo" : "negativo"
  const learnSide = c.suggestedWeight > 0 ? "puxa sua nota pra cima" : "te penaliza"
  const primary = c.flags[0]?.kind
  if (primary === "sign_flip") {
    const base = `Você declarou como ${declSide} (${fmtWeight(c.currentWeight)}), mas o modelo aprendeu que ${learnSide} (${fmtWeight(c.suggestedWeight)}).`
    if (c.confidence === "high") {
      return `${base} A confiança é alta — o dado é consistente, então provavelmente seu peso manual está desatualizado. Vale revisar.`
    }
    if (c.confidence === "medium") {
      return `${base} Confiança média — pode ser que seu gosto real diverja do que você configurou; confira as obras antes de mudar o peso.`
    }
    return `${base} Confiança baixa — forte candidato a ruído de poucas obras: o modelo pode estar culpando esse critério por notas baixas de outra causa.`
  }
  if (primary === "unsupported") {
    return `Seu peso forte (${fmtWeight(c.currentWeight)}) praticamente sumiu no aprendido (${fmtWeight(c.suggestedWeight)}): os dados não confirmam esse efeito. Seu ajuste manual quase não está pegando.`
  }
  // fragile_bet como flag primário
  return `O modelo aposta forte (${fmtWeight(c.suggestedWeight)}) num coeficiente instável (confiança baixa) — provável ruído de poucas obras avaliadas.`
}

function AlertRow({ c }: { c: TasteCriterionHealth }) {
  const isHigh = c.flags.some((f) => f.severity === "high")
  const conf = confBadge(c.confidence)
  return (
    <div
      className={cn(
        "rounded-lg border border-l-[3px] bg-muted/20 p-3",
        isHigh ? "border-l-rose-500" : "border-l-amber-500",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <span aria-hidden>{critEmoji(c.slug)}</span>
          {critName(c.slug)}
        </span>
        {c.flags.map((f) => (
          <span
            key={f.kind}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
              f.severity === "high"
                ? "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300"
                : "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
            )}
          >
            {FLAG_LABEL[f.kind]}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-xs">
          <span className="text-muted-foreground">{fmtWeight(c.currentWeight)}</span>
          <span className="text-muted-foreground/60">→</span>
          <span className={cn("font-bold", c.suggestedWeight >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {fmtWeight(c.suggestedWeight)}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", conf.cls)}>
            {conf.label}
          </span>
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{explain(c)}</p>
      {/* Só as AVALIADAS (com nota pessoal) com o critério alto — são elas que
          treinaram o peso. A URL neutraliza os defaults de "lista de leitura"
          (status + Nota Prevista) pra o conjunto bater com o que treinou o modelo:
          rated=1 (só avaliadas + finalizadas), pub/per=all, min_expected=0, e
          ordena pelo critério (as mais influentes primeiro). */}
      <Link
        href={`/ranking?rated=1&pub_status=all&per_status=all&min_expected=0&min_${c.slug}=7&sort=crit_${c.slug}:desc`}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
      >
        <Search className="size-3" />
        Ver as obras avaliadas que puxam esse peso
      </Link>
    </div>
  )
}

function VerdictCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string
  value: string
  sub: string
  tone?: "neutral" | "warn" | "bad"
}) {
  return (
    <div
      className={cn(
        "min-w-[150px] flex-1 rounded-xl border p-3",
        tone === "bad"
          ? "border-rose-500/30 bg-rose-500/5"
          : tone === "warn"
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border bg-muted/20",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-mono text-xl font-bold tabular-nums",
          tone === "bad" ? "text-rose-600 dark:text-rose-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground/80">{sub}</p>
    </div>
  )
}

export function TasteModelHealthPanel({ health }: { health: TasteModelHealth }) {
  const conflicts = health.counts.signFlip
  const fragile = health.counts.fragile + health.counts.unsupported

  return (
    <div className="rounded-xl border border-border bg-card/50">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
          <Stethoscope className="size-[18px]" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Saúde do modelo de gosto</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            O que o modelo aprendeu das suas notas — e onde ele pode estar te lendo errado. Só leitura.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2.5">
          <VerdictCard
            label="Aprendido de"
            value={`${health.trainSize} obras`}
            sub={health.smallBase ? "base modesta — pesos de baixa confiança são incertos" : "base saudável"}
            tone={health.smallBase ? "warn" : "neutral"}
          />
          <VerdictCard
            label="Conflitos com seu gosto declarado"
            value={String(conflicts)}
            sub="sinal invertido (declarado × aprendido)"
            tone={conflicts > 0 ? "bad" : "neutral"}
          />
          <VerdictCard
            label="Pesos frágeis / sem sustentação"
            value={String(fragile)}
            sub="aposta forte instável ou ajuste manual que não pega"
            tone={fragile > 0 ? "warn" : "neutral"}
          />
        </div>

        {health.flagged.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            Nenhum alerta — o que o modelo aprendeu está alinhado com seus pesos declarados. ✓
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground/70">
              Alertas — critérios pra você conferir
            </p>
            {health.flagged.map((c) => (
              <AlertRow key={c.slug} c={c} />
            ))}
          </div>
        )}

        <details className="group border-t border-border/60 pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            Ver todos os {health.criteria.length} critérios (declarado → aprendido)
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  <th className="px-2 pb-1.5 text-left font-semibold">Critério</th>
                  <th className="px-2 pb-1.5 text-right font-semibold">Declarado</th>
                  <th className="px-2 pb-1.5 text-right font-semibold">Aprendido</th>
                  <th className="px-2 pb-1.5 text-right font-semibold">Δ</th>
                  <th className="px-2 pb-1.5 text-left font-semibold">Confiança</th>
                </tr>
              </thead>
              <tbody>
                {health.criteria.map((c) => {
                  const conf = confBadge(c.confidence)
                  return (
                    <tr key={c.slug} className="border-t border-border/60">
                      <td className="px-2 py-1.5">
                        {critEmoji(c.slug)} {critName(c.slug)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtWeight(c.currentWeight)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtWeight(c.suggestedWeight)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtWeight(c.delta)}</td>
                      <td className="px-2 py-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", conf.cls)}>
                          {conf.label.replace("conf. ", "")}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>

        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          <b className="font-semibold text-muted-foreground">Como é medido:</b> pesos aprendidos por Ridge
          + bootstrap sobre as {health.trainSize} notas; a confiança é a estabilidade do coeficiente
          (sinal/ruído). <b className="font-semibold text-muted-foreground">Como agir:</b> em{" "}
          <Link href="/preferencias#pesos" className="font-medium text-foreground underline-offset-2 hover:underline">
            Preferências → Pesos sugeridos
          </Link>{" "}
          você aceita ou rejeita cada ajuste.
        </p>
      </div>
    </div>
  )
}
