import Link from "next/link"
import { Sparkle, ArrowRight, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ProfileStatus } from "@/server/actions/recommendations"

const MIN_RATED = 5

export function ProfileSummary({ status }: { status: ProfileStatus }) {
  const { profile, ratedWorksCount, isStale } = status
  const ready = profile != null && !profile.is_stub

  const header = (
    <CardHeader className="flex flex-row items-center justify-between pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        <Sparkle className="size-4 text-fuchsia-500" />
        Seu perfil de gosto
      </CardTitle>
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
        <Link href="/conta/perfil">
          Ver perfil
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </CardHeader>
  )

  if (!ready) {
    const remaining = Math.max(0, MIN_RATED - ratedWorksCount)
    return (
      <Card>
        {header}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {ratedWorksCount < MIN_RATED
              ? `Avalie ${remaining} obra(s) a mais (mín. ${MIN_RATED}) para gerar seu perfil de gosto.`
              : "Perfil ainda não gerado. Gere-o na sua conta."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {ratedWorksCount} obra(s) com nota pessoal.
          </p>
        </CardContent>
      </Card>
    )
  }

  const lovedThemes = profile.profile.loved_themes.slice(0, 4)
  const lovedTags = [...profile.profile.loved_tags]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4)
    .map((t) => t.name)
  const chips = Array.from(new Set([...lovedThemes, ...lovedTags])).slice(0, 6)

  return (
    <Card>
      {header}
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{ratedWorksCount} obra(s) avaliada(s)</span>
          {isStale && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200"
            >
              <AlertTriangle className="size-3" />
              Desatualizado
            </Badge>
          )}
        </div>
        {profile.profile.summary && (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {profile.profile.summary}
          </p>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <Badge key={chip} variant="secondary" className="font-normal">
                {chip}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
