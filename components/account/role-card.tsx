import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RoleBadge } from "@/components/account/role-badge"
import { cn } from "@/lib/utils"
import type { Role } from "@/lib/plans/roles"

/**
 * "Seu papel" no /account — a escada, com o usuário marcado.
 *
 * Substitui o PlanCard, que mostrava "Cancelar plano" / "Reativar plano Pago" pra
 * TODO MUNDO. Aqueles botões estavam errados por dois motivos, e o segundo é pior:
 *  1. só o Curador conseguia acioná-los (o `setPlan` virou admin no PR #115) — pros
 *     demais era um botão que falhava na cara;
 *  2. depois da migration 140 eles viraram NO-OP até pro Curador: gravavam
 *     `user_plan`, e o acesso passou a sair de `role`. Botão que finge funcionar é
 *     pior que botão morto. Foram removidos junto com as actions.
 */

interface Rung {
  role: Role
  perms: Array<{ can: boolean; text: string }>
}

const LADDER: Rung[] = [
  {
    role: "curador",
    perms: [
      { can: true, text: "Cria, edita e apaga obras" },
      { can: true, text: "Escolhe capa, sinopse e resolve conflitos" },
      { can: true, text: "IA de curadoria (avaliar, digest, tags)" },
      { can: true, text: "Pesos, cores e configuração global" },
    ],
  },
  {
    role: "assinante",
    perms: [
      { can: true, text: "Atualiza obras (automático, sem escolher)" },
      { can: true, text: "Recomendação, chat e Deep Dive" },
      { can: false, text: "Não cria, edita nem apaga" },
    ],
  },
  {
    role: "leitor",
    perms: [
      { can: true, text: "Lê o catálogo inteiro" },
      { can: false, text: "Sem IA — comprada por crédito" },
      { can: false, text: "Nenhuma escrita" },
    ],
  },
]

const ACCENT: Record<Role, string> = {
  curador: "bg-amber-500",
  assinante: "bg-indigo-500",
  leitor: "bg-muted-foreground/40",
}

export function RoleCard({ role }: { role: Role }) {
  // O CURADOR não aparece na lista de quem não é curador: papel de operação não é
  // degrau de plano. Anunciá-lo como "upgrade" seria mentira — ninguém compra o
  // Curador. Cada um vê o próprio degrau e o que existe acima dele como PLANO.
  const rungs =
    role === "curador" ? LADDER : LADDER.filter((r) => r.role !== "curador")

  return (
    <Card className="overflow-hidden py-0 gap-0">
      <CardHeader className="flex flex-row items-center gap-3 border-b py-4">
        <div>
          <CardTitle className="text-base">Seu papel</CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            O que você pode fazer no catálogo.
          </p>
        </div>
        <RoleBadge role={role} className="ml-auto" />
      </CardHeader>

      <CardContent className="p-0">
        {rungs.map((rung) => {
          const isYou = rung.role === role
          return (
            <div
              key={rung.role}
              className={cn(
                "relative grid gap-4 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[132px_1fr]",
                isYou && "bg-muted/40",
              )}
            >
              {/* Faixa de acento como filho com bg-*, não `border-l-<cor>`: um
                  `* { border-color }` fora de @layer no globals.css vence qualquer
                  utility de cor de borda (Tailwind v4). */}
              {isYou && (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0 left-0 w-[3px]", ACCENT[rung.role])}
                />
              )}

              <div className="flex flex-col items-start gap-1.5">
                <RoleBadge role={rung.role} />
                {isYou && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Você
                  </span>
                )}
              </div>

              <ul className="flex flex-col gap-1">
                {rung.perms.map((p) => (
                  <li
                    key={p.text}
                    className={cn(
                      "flex items-baseline gap-2 text-[13px]",
                      p.can ? "text-muted-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "w-3 shrink-0 text-xs font-bold",
                        p.can ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {p.can ? "✓" : "✕"}
                    </span>
                    {p.text}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </CardContent>

      <div className="border-t bg-muted/30 px-5 py-3.5">
        <p className="text-[13px] text-muted-foreground">
          {role === "curador" ? (
            <>
              Você é o Curador. Ainda <strong className="font-semibold text-foreground">não há cobrança</strong>{" "}
              no app — o papel de cada conta é atribuído direto no banco.
            </>
          ) : (
            <>
              A assinatura ainda <strong className="font-semibold text-foreground">não está aberta</strong> — não
              existe cobrança no app. Fale com o Curador para mudar de papel.
            </>
          )}
        </p>
      </div>
    </Card>
  )
}
