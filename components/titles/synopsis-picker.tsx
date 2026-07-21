"use client"

import { useId, useState } from "react"
import { Check, Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"

/**
 * Escolha de sinopse no passo "Sinopses" — compartilhada pelos DOIS fluxos que a
 * mostram (criação em `ExternalSearch` e `UpdateDataDialog`). Antes o mesmo JSX
 * vivia duplicado nos dois; qualquer invariante (só uma principal, promover
 * quando a principal sai) tinha que ser reescrita nos dois lugares.
 */
export interface SynopsisChoice {
  /** `string` e não `ExternalSourceId`: sinopse manual entra com "manual", que não
   *  faz parte do union de fontes externas (mesma convenção da capa manual). */
  source: string
  text: string
  included: boolean
  isPrimary: boolean
  /** Linha que já está salva na obra. Só o "Atualizar dados" semeia estas — no
   *  create ainda não existe obra. Muda só o rótulo ("já salva" × "nova"). */
  saved?: boolean
  /** Fonte de onde o texto veio ANTES de você editar à mão. Quando presente,
   *  `source` já é "manual" — isto sobrevive só pro rótulo da tela. */
  editedFrom?: string
}

function sourceLabel(source: string): string {
  return PLATFORM_LABELS[source] ?? source
}

function choiceLabel(choice: SynopsisChoice): string {
  if (choice.editedFrom) return `${sourceLabel(choice.editedFrom)} · editada`
  if (choice.source === "manual") return "Sua sinopse"
  return sourceLabel(choice.source)
}

/**
 * Garante a invariante que o servidor também aplica: no máximo uma principal, e
 * ela tem que estar entre as incluídas. Quando a principal sai da seleção, a
 * primeira incluída assume — sem isto a obra ficaria sem sinopse no prompt da IA.
 */
export function normalizeSynopsisChoices(choices: SynopsisChoice[]): SynopsisChoice[] {
  // Índice da vencedora: a primeira incluída que já é principal; senão a primeira
  // incluída. `findIndex` (e não `some`) é o que colapsa duas principais em uma —
  // deixar as duas passar violaria o índice único `work_synopses_one_primary` e o
  // insert falharia na hora de salvar.
  const claimed = choices.findIndex((c) => c.included && c.isPrimary)
  const winner = claimed >= 0 ? claimed : choices.findIndex((c) => c.included)
  return choices.map((c, i) => ({ ...c, isPrimary: i === winner }))
}

interface SynopsisPickerProps {
  choices: SynopsisChoice[]
  onChange: (next: SynopsisChoice[]) => void
  /** Texto do vazio — difere entre criar (veio das fontes) e atualizar (obra já existe). */
  emptyHint?: string
}

export function SynopsisPicker({ choices, onChange, emptyHint }: SynopsisPickerProps) {
  // Índice em edição + rascunho. O rascunho vive aqui (e não no choice) pra que
  // "Cancelar" seja realmente descartar, sem tocar no array do pai.
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const [manualText, setManualText] = useState("")
  const radioGroup = useId()

  const allIncluded = choices.length > 0 && choices.every((c) => c.included)
  const someIncluded = choices.some((c) => c.included)

  const update = (next: SynopsisChoice[]) => onChange(normalizeSynopsisChoices(next))

  const toggleIncluded = (idx: number) => {
    update(choices.map((c, i) => (i === idx ? { ...c, included: !c.included } : c)))
  }

  const setPrimary = (idx: number) => {
    update(choices.map((c, i) => ({ ...c, isPrimary: i === idx, included: i === idx ? true : c.included })))
  }

  const toggleAll = () => {
    const next = !allIncluded
    update(choices.map((c) => ({ ...c, included: next })))
  }

  const openEditor = (idx: number) => {
    setEditingIdx(idx)
    setDraft(choices[idx].text)
  }

  const saveEdit = () => {
    if (editingIdx === null) return
    const text = draft.trim()
    const current = choices[editingIdx]
    if (!text || text === current.text) {
      setEditingIdx(null)
      return
    }
    update(
      choices.map((c, i) => {
        if (i !== editingIdx) return c
        // Texto editado passa a ser SEU: vira source "manual". Não é cosmético —
        // se esta for a principal, o prompt da avaliação IA troca de tom e
        // declara a sinopse como "autoridade máxima sobre a obra"
        // (lib/ai-evaluation/service.ts). Guardamos a fonte só pro rótulo.
        if (c.source === "manual") return { ...c, text }
        return { ...c, text, source: "manual", editedFrom: c.editedFrom ?? c.source }
      })
    )
    setEditingIdx(null)
  }

  const addManual = () => {
    const text = manualText.trim()
    if (!text) return
    update([...choices, { source: "manual", text, included: true, isPrimary: choices.length === 0 }])
    setManualText("")
    setManualOpen(false)
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sinopses</h3>
        {choices.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            Selecionar todas
            <Checkbox
              checked={allIncluded ? true : someIncluded ? "indeterminate" : false}
              onCheckedChange={toggleAll}
            />
          </label>
        )}
      </div>

      {choices.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-xs italic text-muted-foreground">
          {emptyHint ?? "Nenhuma sinopse veio das fontes. Você pode escrever a sua abaixo."}
        </p>
      )}

      {choices.map((s, idx) => {
        const editing = editingIdx === idx
        const isEdited = Boolean(s.editedFrom)
        return (
          <div
            key={`${s.source}-${idx}`}
            // Card inteiro alterna a inclusão; os controles internos param a
            // propagação. Durante a edição o clique não alterna nada (senão
            // clicar no textarea tiraria a sinopse da seleção).
            role={editing ? undefined : "checkbox"}
            aria-checked={editing ? undefined : s.included}
            aria-label={editing ? undefined : `Incluir a sinopse de ${choiceLabel(s)}`}
            tabIndex={editing ? undefined : 0}
            onClick={editing ? undefined : () => toggleIncluded(idx)}
            onKeyDown={
              editing
                ? undefined
                : (e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault()
                      toggleIncluded(idx)
                    }
                  }
            }
            className={cn(
              "space-y-2 rounded-md border p-3 transition-colors",
              !editing && "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring",
              // `ring`, não `border-<cor>`: a regra `* { border-color }` de
              // globals.css mata as utilidades de cor de borda no TW v4 — o
              // `border-primary/60` que estava aqui nunca pintou nada.
              s.included
                ? isEdited
                  ? "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/50"
                  : "bg-primary/5 ring-1 ring-inset ring-primary/50"
                : "bg-transparent opacity-60 hover:opacity-100"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("text-[11px]", isEdited && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")}
                >
                  {choiceLabel(s)}
                </Badge>
                {!isEdited && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {s.saved ? "já salva" : "nova"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    // Nome por instância: o UpdateDataDialog monta um ExternalSearch
                    // dentro dele, e um nome fixo faria os dois pickers dividirem o
                    // mesmo grupo de rádio se algum dia coexistirem na árvore.
                    name={`${radioGroup}-primary`}
                    checked={s.isPrimary}
                    onChange={() => setPrimary(idx)}
                    className="accent-primary"
                  />
                  Principal
                </label>
                {!editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Editar o texto"
                    aria-label={`Editar o texto da sinopse de ${choiceLabel(s)}`}
                    onClick={() => openEditor(idx)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Checkbox
                  checked={s.included}
                  onCheckedChange={() => toggleIncluded(idx)}
                  aria-label="Incluir esta sinopse"
                />
              </div>
            </div>

            {editing ? (
              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={7}
                  className="resize-y text-sm"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <p className="mr-auto text-[11px] leading-tight text-muted-foreground">
                    {s.source === "manual" && !s.editedFrom
                      ? "Já é sua — continua como manual."
                      : "Ao salvar, esta sinopse passa a contar como sua (manual)."}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditingIdx(null)}>
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                    <Check className="h-3.5 w-3.5" />
                    Salvar texto
                  </Button>
                </div>
              </div>
            ) : (
              <p className="line-clamp-6 whitespace-pre-wrap text-xs text-muted-foreground">{s.text}</p>
            )}
          </div>
        )
      })}

      {manualOpen ? (
        <div className="space-y-2 rounded-md border border-dashed border-emerald-500/50 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-muted-foreground">Nova sinopse manual</p>
          <Textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={3}
            placeholder="Escreva uma sinopse própria…"
            className="resize-y text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setManualOpen(false)
                setManualText("")
              }}
            >
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={addManual} disabled={!manualText.trim()}>
              Adicionar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setManualOpen(true)}
          className="gap-1 border-dashed text-primary hover:border-solid"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar sinopse manual
        </Button>
      )}
    </section>
  )
}
