"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown, PenLine, Pencil, Plus, Star } from "lucide-react"
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

/** Rótulo do chip — "Sua sinopse" pra QUALQUER manual (escrita do zero ou editada
 *  de uma fonte), não só a editada. Antes só a editada ganhava destaque, e uma
 *  manual "pura" (via `addManual`) ficava com a cara de uma externa qualquer. */
function chipLabel(choice: SynopsisChoice): string {
  if (choice.source === "manual") return "Sua sinopse"
  return sourceLabel(choice.source)
}

/** Legenda pequena abaixo do chip — aqui sim a origem da edição aparece. */
function metaLabel(choice: SynopsisChoice): string {
  if (choice.source === "manual") {
    return choice.editedFrom ? `${sourceLabel(choice.editedFrom)} · editada` : "escrita por você"
  }
  return choice.saved ? "já salva" : "nova"
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

/**
 * Texto da sinopse cortado em 4 linhas, com "Ver tudo" pra abrir. As sinopses das
 * fontes variam de duas linhas a vários parágrafos, e sem isto as longas ficavam
 * ilegíveis: dava pra escolher a Principal sem conseguir ler o que ela diz.
 */
function SynopsisBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  // O "Ver tudo" só existe quando o texto REALMENTE foi cortado — senão apareceria
  // em sinopse de duas linhas prometendo algo que não acontece. Isso só dá pra
  // saber depois do layout, comparando a altura real com a visível.
  useEffect(() => {
    const el = ref.current
    // Aberto, `scrollHeight === clientHeight` — medir aqui zeraria o `clamped` e
    // o próprio botão que fecha o texto sumiria. Só se mede no estado cortado.
    if (!el || expanded) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    // A largura do card muda quando a janela muda, e com ela quantas linhas cabem:
    // o que entrava em 4 linhas passa a não entrar (e vice-versa).
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="space-y-1">
      <p
        ref={ref}
        className={cn(
          "whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground",
          !expanded && "line-clamp-4"
        )}
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          // O card inteiro é um checkbox: sem parar a propagação (do clique E da
          // tecla), abrir o texto tiraria a sinopse da seleção.
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70 underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {expanded ? "Ver menos" : "Ver tudo"}
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  )
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
  const manualActionsRef = useRef<HTMLDivElement>(null)
  const editActionsRef = useRef<HTMLDivElement>(null)

  // O picker vive no fim de um diálogo com rolagem, e o textarea cresce com o
  // conteúdo (field-sizing-content): abrir o formulário — e principalmente COLAR
  // um texto longo — empurrava a linha de botões pra baixo da dobra, e o próximo
  // botão visível era o "Continuar" do rodapé do diálogo. Seguir a LINHA DE
  // BOTÕES (não o formulário) a cada mudança de texto mantém o alvo do clique à
  // vista; com `block: "nearest"`, quando ela já está visível o scroll é no-op.
  // `?.()` no método: o jsdom dos testes de componente não implementa scrollIntoView.
  useEffect(() => {
    if (manualOpen) manualActionsRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [manualOpen, manualText])
  useEffect(() => {
    if (editingIdx !== null) editActionsRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [editingIdx, draft])

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

  // Duas seções: a sua (manual) sempre primeiro, depois as das fontes — em vez de
  // uma lista única onde a única pista de qual é a sua era a cor da borda. O
  // índice original (`idx`) viaja junto pra toggle/edit/setPrimary continuarem
  // batendo com a posição real em `choices`.
  const indexed = choices.map((c, idx) => ({ c, idx }))
  const manualEntries = indexed.filter(({ c }) => c.source === "manual")
  const externalEntries = indexed.filter(({ c }) => c.source !== "manual")

  const renderCard = (s: SynopsisChoice, idx: number, isManual: boolean) => {
    const editing = editingIdx === idx
    return (
      <div
        key={`${s.source}-${idx}`}
        // Card inteiro alterna a inclusão; os controles internos param a
        // propagação. Durante a edição o clique não alterna nada (senão
        // clicar no textarea tiraria a sinopse da seleção).
        role={editing ? undefined : "checkbox"}
        aria-checked={editing ? undefined : s.included}
        aria-label={editing ? undefined : `Incluir a sinopse de ${chipLabel(s)}`}
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
          "relative space-y-2 overflow-hidden rounded-xl border p-3 pl-4 transition-colors",
          !editing && "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring",
          !s.included && "opacity-60 hover:opacity-100",
          // `ring`, não `border-<cor>`: a regra `* { border-color }` de
          // globals.css mata as utilidades de cor de borda no TW v4 — por isso o
          // friso lateral abaixo usa `bg-*` (span absoluto) em vez de border-left.
          s.included && (isManual ? "bg-emerald-500/[0.04]" : "bg-primary/5 ring-1 ring-inset ring-primary/50")
        )}
      >
        {/* Friso lateral — o principal sinal de "isto é seu". Discreto de propósito,
            só a cor (sem preencher o card inteiro de esmeralda). */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-2.5 left-0 w-[3px] rounded-full",
            isManual ? "bg-emerald-500" : s.included ? "bg-primary" : "bg-transparent"
          )}
        />

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge
              variant="outline"
              className={cn(
                "text-[11px]",
                isManual && "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {isManual && <PenLine className="h-2.5 w-2.5" />}
              {chipLabel(s)}
            </Badge>
            <span className="text-[11px] font-medium text-muted-foreground">{metaLabel(s)}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={s.isPrimary}
              onClick={() => setPrimary(idx)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition-colors",
                s.isPrimary
                  ? isManual
                    ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950"
                    : "bg-primary text-primary-foreground"
                  : "border border-dashed text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className={cn("h-2.5 w-2.5", s.isPrimary && "fill-current")} />
              {s.isPrimary ? "Principal" : "Definir Principal"}
            </button>
            {!editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Editar o texto"
                aria-label={`Editar o texto da sinopse de ${chipLabel(s)}`}
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
              // Mesmo teto do formulário manual: field-sizing-content + colar
              // texto longo esticava a caixa e escondia os botões do formulário.
              className="max-h-64 resize-y overflow-y-auto text-sm"
              autoFocus
            />
            <div ref={editActionsRef} className="flex scroll-mb-16 items-center gap-2">
              <p className="mr-auto text-[11px] leading-tight text-muted-foreground">
                {s.source === "manual" && !s.editedFrom
                  ? "Já é sua — continua como manual."
                  : "Ao salvar, esta sinopse passa a contar como sua (manual)."}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingIdx(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveEdit}
                disabled={!draft.trim()}
                className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                <Check className="h-3.5 w-3.5" />
                Salvar texto
              </Button>
            </div>
          </div>
        ) : (
          <SynopsisBody text={s.text} />
        )}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Sinopses</h3>
        {choices.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            Selecionar todas
            <Checkbox
              checked={allIncluded ? true : someIncluded ? "indeterminate" : false}
              onCheckedChange={toggleAll}
            />
          </label>
        )}
      </div>

      {choices.length === 0 && (
        <p className="rounded-xl border border-dashed p-3 text-xs italic text-muted-foreground">
          {emptyHint ?? "Nenhuma sinopse veio das fontes. Você pode escrever a sua abaixo."}
        </p>
      )}

      {manualEntries.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            <PenLine className="h-3 w-3" />
            Sua sinopse
          </p>
          {manualEntries.map(({ c, idx }) => renderCard(c, idx, true))}
        </div>
      )}

      {externalEntries.length > 0 && (
        <div className="space-y-2">
          {manualEntries.length > 0 && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Das fontes externas{" "}
              <span className="font-medium tracking-normal normal-case text-muted-foreground/70">
                · {externalEntries.length}
              </span>
            </p>
          )}
          {externalEntries.map(({ c, idx }) => renderCard(c, idx, false))}
        </div>
      )}

      {manualOpen ? (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">Nova sinopse manual</p>
          <Textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={3}
            placeholder="Escreva ou cole uma sinopse própria…"
            // max-h + rolagem própria: o Textarea base usa field-sizing-content, e
            // colar uma sinopse longa esticava a caixa até empurrar o "Adicionar"
            // pra fora da área visível do diálogo.
            className="max-h-48 resize-y overflow-y-auto text-sm"
            autoFocus
          />
          {/* scroll-mb-16: os diálogos que montam este picker têm uma barra de ações
              sticky no rodapé DA MESMA área de rolagem — sem a margem, o
              scrollIntoView "revela" a linha exatamente atrás da barra. */}
          <div ref={manualActionsRef} className="flex scroll-mb-16 justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setManualOpen(false)
                setManualText("")
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={addManual}
              disabled={!manualText.trim()}
              className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar sinopse
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setManualOpen(true)}
          className="gap-1 border-dashed text-muted-foreground hover:text-emerald-700 dark:hover:text-emerald-400"
        >
          <Plus className="h-3.5 w-3.5" />
          {manualEntries.length > 0 ? "Adicionar outra sinopse manual" : "Adicionar sinopse manual"}
        </Button>
      )}
    </section>
  )
}
