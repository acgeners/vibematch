"use client"

import { useState, useTransition } from "react"
import { AlertTriangle, ChevronDown, Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TasteProfileSummary } from "@/components/titles/recommendations/taste-profile-summary"
import { generateTasteProfileAction } from "@/server/actions/recommendations"
import type { ProfileStatus } from "@/server/actions/recommendations"
import type { TasteProfileRow } from "@/lib/ai-recommendation/types"

interface TasteProfileCardProps {
  status: ProfileStatus
}

export function TasteProfileCard({ status }: TasteProfileCardProps) {
  const [profile, setProfile] = useState<TasteProfileRow | null>(status.profile)
  const [isStale, setIsStale] = useState(status.isStale)
  const [expanded, setExpanded] = useState(false)
  const [recompute, startRecompute] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const insufficient = status.ratedWorksCount < 5

  const handleRecompute = () => {
    setError(null)
    startRecompute(async () => {
      const res = await generateTasteProfileAction()
      if (res.error) setError(res.error)
      else if (res.data) {
        setProfile(res.data)
        setIsStale(false)
        setExpanded(true)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Perfil de gosto</CardTitle>
            <CardDescription className="text-xs">
              {status.ratedWorksCount} obra(s) com nota pessoal
              {isStale && profile && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="h-3 w-3" /> pode estar defasado
                </span>
              )}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRecompute}
            disabled={recompute || insufficient}
            title={
              insufficient
                ? "Avalie pelo menos 5 obras com user_score"
                : isStale
                  ? "Perfil pode estar defasado — recompute"
                  : "Recomputar perfil"
            }
          >
            {recompute ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">{profile ? "Recomputar" : "Gerar perfil"}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insufficient && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Avalie pelo menos 5 obras com user_score pra desbloquear o ranking IA.
          </div>
        )}

        {profile && profile.is_stub && (
          <Badge variant="outline" className="text-amber-700 border-amber-500/40">
            Perfil incompleto — avalie mais obras pra desbloquear o ranking
          </Badge>
        )}

        {profile && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-medium hover:text-primary"
            >
              <span>{expanded ? "Ocultar detalhes" : "Ver detalhes do perfil"}</span>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
              />
            </button>
            {!expanded && profile.profile.summary && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {profile.profile.summary}
              </p>
            )}
            {expanded && (
              <div className="border-t pt-3">
                <TasteProfileSummary profile={profile} />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
