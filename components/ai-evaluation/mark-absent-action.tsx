"use client"

import { useState } from "react"
import { EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { markWorksAbsentFromSource } from "@/server/actions/source-links"
import { sourceLabel } from "@/lib/external/source-labels"
import { useRefresh } from "@/lib/use-refresh"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * "Marcar como ausentes em <Fonte>" — o lote que de fato ESVAZIA a fila de Fontes.
 *
 * 🔴 **Só existe com um chip de fonte ativo.** Declarar "não existe" sem dizer ONDE é
 * uma afirmação sem sujeito: a obra tem lacuna em várias fontes, e um lote ambíguo
 * gravaria a ausência na fonte errada. Sem chip, o botão nem é renderizado — quem
 * decide o sujeito da frase é o filtro que a pessoa já escolheu.
 *
 * 🔴 **Confirmação obrigatória, e ela mostra o NÚMERO e a FONTE.** A declaração tira a
 * obra da fila para sempre (é o que `absent` significa), então é ação que não se
 * desfaz por acaso — o desfazer existe, mas obra a obra.
 *
 * ⚠️ **Não há varredura automática por trás, de propósito.** Medido em 2026-08-15
 * contra verdade conhecida (30 obras que comprovadamente estão no mangago): uma busca
 * por título com o limiar de aceite deixaria 7% delas abaixo do corte ⇒ ~12 declarações
 * FALSAS em 175 obras, que somem da fila e ninguém revisita. O lote grava o que VOCÊ
 * verificou; o texto do diálogo diz isso.
 */
export function MarkAbsentAction({
  workIds,
  source,
  onDone,
}: {
  workIds: string[]
  source: ExternalSourceId
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const refresh = useRefresh()
  const label = sourceLabel(source)
  const n = workIds.length

  const run = async () => {
    setSaving(true)
    try {
      const res = await markWorksAbsentFromSource(workIds, source)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(
        `${res.marked} obra(s) marcada(s) como ausente(s) em ${label}.` +
          // A guarda do servidor pode pular obras que ganharam vínculo enquanto a lista
          // estava aberta. Silenciar isso faria o número do toast não bater com a lista.
          (res.skipped > 0 ? ` ${res.skipped} pulada(s): já tinham vínculo.` : ""),
      )
      setOpen(false)
      onDone?.()
      refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={n === 0}>
        <EyeOff className="h-3.5 w-3.5" />
        Marcar ausente em {label} ({n})
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Marcar {n} obra(s) como ausente(s) em {label}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Isto afirma que <strong>essas obras não existem em {label}</strong> — elas saem
                  da fila de Fontes e não voltam sozinhas.
                </p>
                <p className="text-muted-foreground">
                  Marque só o que você conferiu. Nenhuma busca automática foi feita: numa
                  amostra de 30 obras que comprovadamente estão no Mangago, a busca por título
                  não alcançaria o limiar em <strong>7%</strong> delas — e cada erro desses vira
                  uma ausência falsa que ninguém revisita.
                </p>
                <p className="text-muted-foreground">
                  Dá pra desfazer depois, obra a obra, pelo diálogo de fontes.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void run()
              }}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Marcar ${n} como ausente(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
