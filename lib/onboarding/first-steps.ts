import { ENSO_GOAL } from "@/lib/onboarding/enso"

/** O cookie do "Esconder" do card: preferência de tela que o servidor desenha (regra do CLAUDE.md). */
export const FIRST_STEPS_HIDDEN_COOKIE = "first_steps_hidden"

/** A partir de quantas obras avaliadas o perfil de gosto pode ser gerado. */
export const PROFILE_MIN_RATED = 10

export interface FirstStepsInput {
  saidTastes: boolean
  broughtList: boolean
  interestMarked: number
  interestGoal: number
  profileGenerated: boolean
  ratedCount: number
}

export interface FirstStep {
  title: string
  sub: string
  done: boolean
  cta: { label: string; href: string } | null
  /** "Tem lista em outro site? Importar…": atalho, não passo (decisão de 19/11/2026). */
  importShortcut: boolean
}

/**
 * Os 4 passos do card "Primeiros passos" (mockup aprovado em 19/11/2026). Importar a lista NÃO é
 * passo — é atalho do passo das 20 notas: um passo que quem não tem lista nunca conclui ficaria
 * pendente para sempre.
 */
export function buildFirstSteps(p: FirstStepsInput): {
  steps: FirstStep[]
  /** O primeiro passo por fazer: só ele leva o botão cheio. -1 = todos feitos. */
  current: number
  doneCount: number
  /** 20 notas: a Nota Prevista ligou e o card dá lugar a um aviso de uma linha. */
  predictionOn: boolean
} {
  const predictionOn = p.ratedCount >= ENSO_GOAL
  const missing = Math.max(0, ENSO_GOAL - p.ratedCount)
  const steps: FirstStep[] = [
    {
      title: "Dizer o que você gosta e evita",
      sub: "Gêneros que te atraem e vetos que te poupam tempo.",
      done: p.saidTastes,
      // As boas-vindas, e não /preferences: é o caminho guiado.
      cta: { label: "Escolher", href: "/welcome" },
      importShortcut: false,
    },
    {
      title: `Dar nota a ${ENSO_GOAL} obras que você já leu`,
      sub: predictionOn
        ? "Feito: a Nota Prevista está ligada."
        : `Você tem ${p.ratedCount}. Faltam ${missing} — a nota de cada obra lida é o que ensina a Nota Prevista.`,
      done: predictionOn,
      cta: { label: "Dar notas", href: "/rate" },
      importShortcut: !predictionOn && !p.broughtList,
    },
    {
      title: `Marcar ${p.interestGoal} obras que te interessam`,
      sub:
        p.interestMarked > 0
          ? `Você marcou ${p.interestMarked}. O ♥ treina o preditor de Interesse.`
          : "O ♥ é o sinal mais barato que existe — e treina o preditor de Interesse.",
      done: p.interestMarked >= p.interestGoal,
      cta: { label: "Explorar", href: "/catalog" },
      importShortcut: false,
    },
    {
      title: "Gerar seu perfil de gosto",
      sub:
        p.ratedCount >= PROFILE_MIN_RATED
          ? `Disponível: você tem ${p.ratedCount} obras avaliadas.`
          : `Disponível a partir de ${PROFILE_MIN_RATED} obras avaliadas — você tem ${p.ratedCount}.`,
      done: p.profileGenerated,
      cta: p.ratedCount >= PROFILE_MIN_RATED ? { label: "Gerar", href: "/account/taste-profile" } : null,
      importShortcut: false,
    },
  ]
  return {
    steps,
    current: steps.findIndex((s) => !s.done),
    doneCount: steps.filter((s) => s.done).length,
    predictionOn,
  }
}
