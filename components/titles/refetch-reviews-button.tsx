"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, MessageSquareText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { refetchWorkReviews } from "@/server/actions/reviews"
import { getWorkUpdateStatus } from "@/server/actions/update-status"
import { useRefresh } from "@/lib/use-refresh"

const POLL_MS = 4_000
const MAX_POLLS = 30 // ~120s — cobre o Mangago (o mais lento) com folga

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Botão "Buscar reviews": dispara SÓ a aquisição de reviews externas (das fontes já
 * vinculadas), sem o fluxo de "Atualizar dados". Dá feedback PRÓPRIO e inline (toast
 * de progresso + estado "Buscando…" no botão + poll até terminar), já que a faixa do
 * watcher fica no topo da página e pode estar fora da vista aqui embaixo.
 */
export function RefetchReviewsButton({ workId }: { workId: string }) {
  const [loading, setLoading] = useState(false)
  const refresh = useRefresh()
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

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
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS)
        if (!mounted.current) return
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

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading} className="gap-1.5">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
      {loading ? "Buscando reviews…" : "Buscar reviews"}
    </Button>
  )
}
