"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, MessageSquareText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { refetchWorkReviews } from "@/server/actions/reviews"
import { getWorkUpdateStatus } from "@/server/actions/update-status"
import { useRefresh } from "@/lib/use-refresh"

type BtnVariant = "default" | "outline" | "ghost" | "secondary"
type BtnSize = "sm" | "default"

const POLL_MS = 4_000
const MAX_POLLS = 30 // ~120s — cobre o Mangago (o mais lento) com folga

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Botão "Buscar reviews": dispara SÓ a aquisição de reviews externas (das fontes já
 * vinculadas), sem o fluxo de "Atualizar dados". Dá feedback PRÓPRIO e inline (toast
 * de progresso + estado "Buscando…" no botão + poll até terminar), já que a faixa do
 * watcher fica no topo da página e pode estar fora da vista aqui embaixo.
 */
export function RefetchReviewsButton({
  workId,
  variant = "outline",
  size = "sm",
  className,
  iconOnly = false,
}: {
  workId: string
  variant?: BtnVariant
  size?: BtnSize
  className?: string
  /**
   * Só o ícone, com o rótulo no `title`/`aria-label`. É a forma usada no card de reviews:
   * ali a ação é de CURADORIA e não pode ter mais peso visual que o conteúdo, que é o que
   * o leitor veio ler.
   */
  iconOnly?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const refresh = useRefresh()
  const mounted = useRef(true)
  // Reafirmar `true` no mount é obrigatório: em dev o StrictMode monta → roda o
  // cleanup → remonta. Sem esta linha o cleanup zerava a flag e ela NUNCA voltava,
  // então `setLoading(false)` no finally nunca rodava e o botão ficava travado em
  // "Buscando reviews…" pra sempre (em dev, em toda e qualquer busca).
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const onClick = async () => {
    if (loading) return
    setLoading(true)
    const toastId = toast.loading("Buscando reviews em segundo plano…")
    try {
      const r = await refetchWorkReviews(workId)
      if (!r.ok) {
        toast.error("Não consegui iniciar a busca de reviews.", { id: toastId })
        return
      }
      // Espera o job terminar (o after() do servidor, ~35s pelo Mangago).
      //
      // NÃO abortar o loop se o componente desmontar: o `UpdateProgressWatcher` faz poll
      // do MESMO job e, ao ver "done", dá refresh na página — o que REMONTA este botão.
      // Se saíssemos aqui, o toast (que é global, do sonner, e não pertence a este
      // componente) ficaria girando "Buscando…" pra sempre, porque `toast.loading` não
      // expira sozinho. O loop tem teto (MAX_POLLS), então ele sempre termina e resolve
      // o toast; só o setState é que precisa respeitar o unmount.
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS)
        let status: Awaited<ReturnType<typeof getWorkUpdateStatus>>
        try {
          status = await getWorkUpdateStatus(workId)
        } catch {
          continue // transitório — tenta de novo
        }
        if (status.state === "done") {
          const n = status.reviewsAdded
          toast.success(
            n && n > 0 ? `${n} nova${n > 1 ? "s" : ""} review${n > 1 ? "s" : ""} encontrada${n > 1 ? "s" : ""}.` : "Reviews atualizadas.",
            { id: toastId },
          )
          refresh()
          return
        }
      }
      // Estourou o teto de espera — não trava o botão; avisa que segue em background.
      toast.info("A busca está demorando — as reviews aparecem em instantes.", { id: toastId })
    } catch {
      toast.error("Falha ao buscar reviews.", { id: toastId })
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  const label = loading ? "Buscando reviews…" : "Buscar reviews"

  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={loading}
      title={iconOnly ? label : undefined}
      aria-label={iconOnly ? label : undefined}
      className={cn("gap-1.5", iconOnly && "size-8 p-0", className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
      {!iconOnly && label}
    </Button>
  )
}
