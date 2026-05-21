"use client"

import { Badge } from "@/components/ui/badge"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"

interface TasteProfileSummaryProps {
  profile: TasteProfileRow
}

export function TasteProfileSummary({ profile }: TasteProfileSummaryProps) {
  const p = profile.profile
  const formattedDate = new Date(profile.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Perfil v{profile.version}</span>
        <span>•</span>
        <span>{profile.n_works_used} obras analisadas</span>
        <span>•</span>
        <span>{formattedDate}</span>
        {profile.is_stub && (
          <Badge variant="outline" className="text-amber-600 border-amber-500/40">
            stub
          </Badge>
        )}
      </div>

      {p.summary && <p className="text-foreground leading-relaxed">{p.summary}</p>}

      {p.loved_tags.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags amadas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.loved_tags.slice(0, 16).map((tag) => (
              <Badge
                key={`${tag.group ?? ""}::${tag.name}`}
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300"
                title={tag.group ? `grupo: ${tag.group} • força: ${(tag.strength * 100).toFixed(0)}%` : `força: ${(tag.strength * 100).toFixed(0)}%`}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {p.avoided_tags.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tags evitadas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.avoided_tags.slice(0, 16).map((tag) => (
              <Badge
                key={`${tag.group ?? ""}::${tag.name}`}
                variant="secondary"
                className="bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300"
                title={tag.group ? `grupo: ${tag.group} • força: ${(tag.strength * 100).toFixed(0)}%` : `força: ${(tag.strength * 100).toFixed(0)}%`}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {p.loved_themes.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Temas que você curte
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-foreground/90">
            {p.loved_themes.map((theme) => (
              <li key={theme}>{theme}</li>
            ))}
          </ul>
        </div>
      )}

      {p.avoided_themes.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Temas que você evita
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-foreground/90">
            {p.avoided_themes.map((theme) => (
              <li key={theme}>{theme}</li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(p.criterion_preferences).length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Preferências por critério
          </p>
          <div className="space-y-1.5">
            {Object.entries(p.criterion_preferences)
              .sort(([, a], [, b]) => b.weight - a.weight)
              .map(([slug, pref]) => {
                const info = CRITERIA_INFO[slug]
                return (
                  <div key={slug} className="flex items-center gap-2">
                    <span className="w-44 shrink-0 text-foreground/90">
                      {info?.emoji} {info?.name ?? slug}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {pref.ideal_min.toFixed(1)}–{pref.ideal_max.toFixed(1)}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      peso {(pref.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {p.narrative_patterns.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Padrões narrativos
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-foreground/90">
            {p.narrative_patterns.map((pattern) => (
              <li key={pattern}>{pattern}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
