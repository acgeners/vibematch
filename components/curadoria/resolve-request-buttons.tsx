"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { resolveCurationRequest } from "@/server/actions/curation-requests"

/**
 * Fecha um pedido: "atendi" ou "não vou atender".
 *
 * Fecha, não apaga — o histórico é o que vai permitir avisar quem pediu, quando esse canal
 * existir (adiado de propósito; ver o mockup da curadoria centralizada).
 *
 * Os dois botões ficam desabilitados enquanto a ação corre. Sem isso, um duplo clique dispara
 * duas chamadas: a segunda não estraga nada (o update filtra por `status = 'open'`), mas o
 * usuário vê dois toasts e não sabe qual valeu.
 */
export function ResolveRequestButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  const [feito, setFeito] = useState(false)

  const fechar = (status: "done" | "dismissed") => {
    startTransition(async () => {
      const r = await resolveCurationRequest(id, status)
      if (!r.ok) {
        toast.error(r.error ?? "Não consegui fechar o pedido.")
        return
      }
      setFeito(true)
      toast.success(status === "done" ? "Pedido marcado como atendido." : "Pedido descartado.")
    })
  }

  // A linha some da lista no próximo carregamento (o `revalidatePath` da action). Até lá,
  // desabilitar evita clicar de novo no que já foi resolvido.
  const travado = pending || feito

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" variant="outline" disabled={travado} onClick={() => fechar("dismissed")}>
        Descartar
      </Button>
      <Button size="sm" disabled={travado} onClick={() => fechar("done")}>
        Atendi
      </Button>
    </div>
  )
}
