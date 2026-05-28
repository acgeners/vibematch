import { Sparkles, AlertTriangle } from "lucide-react"
import { CRITERION_SLUGS } from "@/types/domain"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"
import { cn } from "@/lib/utils"

interface TasteProfileHealthProps {
  tasteProfile: TasteProfileRow | null
}

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days === 0) return "hoje"
  if (days === 1) return "ontem"
  if (days < 30) return `há ${days} dias`
  const months = Math.floor(days / 30)
  if (months < 12) return `há ${months} mês${months > 1 ? "es" : ""}`
  return date.toLocaleDateString("pt-BR")
}

/**
 * Card diagnóstico do TasteProfile atual. Mostra:
 *   - Status (stub vs cheio) + idade
 *   - Contagem de loved_tags / avoided_tags com top 3 de cada
 *   - Quantos dos 9 critérios IA têm preferência configurada (e quantos com peso > 0)
 *   - Tamanho do summary / narrative_patterns
 *
 * Útil pra entender por que o `personal_fit` está alto/baixo —
 * perfil magro = poucos sinais = scores baixos pra TODAS as obras.
 */
export function TasteProfileHealth({ tasteProfile }: TasteProfileHealthProps) {
  if (!tasteProfile) {
    return (
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Sem TasteProfile ainda</h3>
            <p className="text-xs text-muted-foreground">
              O <code className="font-mono">personal_fit</code> e features de perfil no L1 dependem
              de um TasteProfile. Avalie pelo menos {5} obras com <code className="font-mono">manual_score</code>{" "}
              e use o botão de gerar perfil em <code className="font-mono">/settings</code> ou{" "}
              <code className="font-mono">/recommendations</code>.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const profile = tasteProfile.profile
  const isStub = tasteProfile.is_stub
  const lovedCount = profile.loved_tags?.length ?? 0
  const avoidedCount = profile.avoided_tags?.length ?? 0
  const totalCriteria = CRITERION_SLUGS.length
  const criteriaWithPref = Object.keys(profile.criterion_preferences ?? {}).length
  const criteriaWithStrongWeight = Object.values(profile.criterion_preferences ?? {})
    .filter((p): p is NonNullable<typeof p> => p != null)
    .filter((p) => (p.weight ?? 0) >= 0.5).length
  const narrativeCount = profile.narrative_patterns?.length ?? 0
  const summaryLen = profile.summary?.length ?? 0

  const topLoved = [...(profile.loved_tags ?? [])]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)
  const topAvoided = [...(profile.avoided_tags ?? [])]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3)

  // Saúde heurística: perfil é "magro" se loved_tags < 5 ou criteriaWithStrongWeight < 3.
  // Saúde do perfil afeta TETO do personal_fit — perfil magro = todas as obras
  // pontuam baixo (independente de quão alinhadas elas são na realidade).
  const isThin = lovedCount < 5 || criteriaWithStrongWeight < 3
  const healthLabel = isStub ? "Stub" : isThin ? "Magro" : "Saudável"
  const healthColor = isStub
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
    : isThin
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"

  return (
    <section className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Sparkles className="h-5 w-5 shrink-0 text-violet-500 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Saúde do TasteProfile</h3>
            <p className="text-xs text-muted-foreground">
              Diagnóstico do perfil que alimenta <code className="font-mono">personal_fit</code> e
              as features de alinhamento no L1.
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
            healthColor,
          )}
        >
          {healthLabel}
        </span>
      </header>

      {isThin && !isStub && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <strong>Perfil magro</strong> ({lovedCount} loved_tags, {criteriaWithStrongWeight}/9
          critérios com weight ≥ 0.5). Isso limita o TETO matemático do{" "}
          <code className="font-mono">personal_fit</code> — obras realmente alinhadas com seu
          gosto vão ainda pontuar 35-55% como máximo. Avaliar mais obras com{" "}
          <code className="font-mono">manual_score</code> e regenerar o perfil enriquece os
          sinais.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <Stat
          label="Treino"
          value={`${tasteProfile.n_works_used} obras`}
          hint={`Versão ${tasteProfile.version} • ${timeAgo(tasteProfile.created_at)}`}
        />
        <Stat
          label="Critérios IA"
          value={`${criteriaWithStrongWeight}/${totalCriteria}`}
          hint={`weight ≥ 0.5 (${criteriaWithPref} no total)`}
        />
        <Stat
          label="Loved tags"
          value={lovedCount.toString()}
          hint={lovedCount < 5 ? "Pouco — alvo ≥ 8" : "Suficiente"}
        />
        <Stat
          label="Avoided tags"
          value={avoidedCount.toString()}
          hint={avoidedCount === 0 ? "Sem tags evitadas" : "Penaliza com 1.5×"}
        />
      </div>

      {(topLoved.length > 0 || topAvoided.length > 0) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
          {topLoved.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold">
                Top loved
              </p>
              <ul className="space-y-0.5">
                {topLoved.map((t) => (
                  <li key={`${t.group}::${t.name}`} className="flex justify-between gap-2">
                    <span className="text-foreground truncate">{t.name}</span>
                    <span className="font-mono text-muted-foreground">{(t.strength * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {topAvoided.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-rose-600 dark:text-rose-400 font-semibold">
                Top avoided
              </p>
              <ul className="space-y-0.5">
                {topAvoided.map((t) => (
                  <li key={`${t.group}::${t.name}`} className="flex justify-between gap-2">
                    <span className="text-foreground truncate">{t.name}</span>
                    <span className="font-mono text-muted-foreground">{(t.strength * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {profile.summary && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Summary do perfil ({summaryLen} chars) {narrativeCount > 0 && `· ${narrativeCount} padrões narrativos`}
          </summary>
          <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-3">
            <p className="leading-relaxed">{profile.summary}</p>
            {narrativeCount > 0 && (
              <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                {profile.narrative_patterns.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-mono font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
