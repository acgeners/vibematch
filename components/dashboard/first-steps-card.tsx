import Link from "next/link"
import { Check, Compass } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { FirstStepsProgress } from "@/server/queries/onboarding-progress"

interface StepRow {
  done: boolean
  title: string
  sub: string
  cta?: { label: string; href: string }
}

/**
 * A PONTE do onboarding (mockup = spec): "noventa segundos não fazem um perfil
 * maduro". Fica no dashboard até a conta sair do estado inicial — o caller já não
 * renderiza quando `complete` (some sozinho) ou quando não há sessão.
 */
export function FirstStepsCard({ progress }: { progress: FirstStepsProgress }) {
  const steps: StepRow[] = [
    {
      done: progress.saidTastes,
      title: "Dizer o que você gosta e evita",
      sub: "Gêneros que te atraem e vetos que te poupam tempo.",
      cta: { label: "Escolher", href: "/preferences" },
    },
    {
      done: progress.broughtList,
      title: "Trazer sua lista de outro site",
      sub: "AniList, MyAnimeList, MangaUpdates ou Anime-Planet — nota, status e capítulos.",
      cta: { label: "Importar", href: "/import" },
    },
    {
      done: progress.interestMarked >= progress.interestGoal,
      title: `Marcar ${progress.interestGoal} obras que te interessam`,
      sub:
        progress.interestMarked > 0
          ? `Você marcou ${progress.interestMarked}.`
          : "O ♥ é o sinal mais barato que existe — e treina o preditor de Interesse.",
      cta: { label: "Explorar", href: "/catalog" },
    },
    {
      done: progress.firstSheet,
      title: "Preencher a primeira ficha pós-leitura",
      sub: "Sete eixos, 30 segundos. É a nota mais precisa que existe no app.",
      cta: { label: "Ver como", href: "/guide" },
    },
    {
      done: progress.profileGenerated,
      title: "Gerar seu perfil de gosto",
      sub: `Disponível a partir de 10 obras avaliadas — você tem ${progress.ratedCount}.`,
      cta: { label: "Gerar", href: "/account/taste-profile" },
    },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <Card className="relative overflow-hidden">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-sky-300 via-primary to-transparent"
      />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" />
          Primeiros passos
        </CardTitle>
        <span className="font-mono text-xs tabular-nums text-primary">
          {doneCount} de {steps.length}
        </span>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {steps.map((s) => (
          <div key={s.title} className="flex items-start gap-3 px-6 py-3">
            <span
              className={`mt-0.5 grid size-[18px] flex-none place-items-center rounded-[5px] border text-white ${
                s.done ? "border-emerald-500 bg-emerald-500" : "border-border"
              }`}
            >
              {s.done && <Check className="size-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm font-semibold ${s.done ? "text-muted-foreground line-through" : ""}`}
              >
                {s.title}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{s.sub}</span>
            </span>
            {!s.done && s.cta && (
              <Link
                href={s.cta.href}
                className="self-center whitespace-nowrap text-xs font-semibold text-primary hover:underline"
              >
                {s.cta.label} →
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
