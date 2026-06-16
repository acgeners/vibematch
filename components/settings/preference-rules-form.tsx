"use client"

import { useMemo, useState, useTransition } from "react"
import { Plus, Trash2, Save, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { savePreferenceRules } from "@/server/actions/preference-rules"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

// Espelha os caps de produto de server/queries/preference-rules.ts.
const MAX_RULES = 8
const MAX_LEN = 200

interface RuleItem {
  id: string
  text: string
  enabled: boolean
}

interface PreferenceRulesFormProps {
  initialRules: RuleItem[]
}

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Assinatura estável pra detectar "sujo" (texto + ativa, na ordem atual). */
function signature(rules: RuleItem[]): string {
  return rules.map((r) => `${r.enabled ? "1" : "0"}:${r.text.trim()}`).join("¦")
}

export function PreferenceRulesForm({ initialRules }: PreferenceRulesFormProps) {
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [rules, setRules] = useState<RuleItem[]>(initialRules)

  const baseSig = useMemo(() => signature(initialRules), [initialRules])
  const dirty = signature(rules) !== baseSig
  const atCap = rules.length >= MAX_RULES

  const addRule = () => {
    if (atCap) return
    setRules((prev) => [...prev, { id: makeId(), text: "", enabled: true }])
  }
  const removeRule = (id: string) => setRules((prev) => prev.filter((r) => r.id !== id))
  const setText = (id: string, text: string) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, text: text.slice(0, MAX_LEN) } : r)))
  const toggle = (id: string, enabled: boolean) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))

  const handleSave = () => {
    const payload = rules
      .map((r) => ({ id: r.id, text: r.text.trim(), enabled: r.enabled }))
      .filter((r) => r.text.length > 0)
    startTransition(async () => {
      const res = await savePreferenceRules(payload)
      if (res.ok) {
        toast.success("Preferências salvas.")
        refresh()
      } else {
        toast.error(res.error ?? "Falha ao salvar.")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs text-violet-700 dark:text-violet-300">
        Estas regras entram só na <strong>IA sob demanda</strong> (Recomendar, Deep Dive,
        Desempatar, Chat) e valem na próxima recomendação — <strong>sem recalcular</strong>. O
        ranking padrão não muda; pra ajustar o ranking use <strong>Tags que amo / evito</strong>.
        Vale escrever regras condicionais (“evito tragédia, exceto quando o casal é forte”) ou
        preferências gerais (“valorizo arte detalhada mesmo com história simples”; “em obras com
        poucas tags, confie mais nas reviews”).
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma regra ainda. Adicione orientações pro consultor IA.
        </p>
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex gap-2 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <span className="flex pt-1.5" title={r.enabled ? "Ativa" : "Pausada"}>
                <Checkbox
                  checked={r.enabled}
                  onCheckedChange={(v) => toggle(r.id, v === true)}
                  aria-label="Regra ativa"
                />
              </span>
              <div className="min-w-0 flex-1">
                <Textarea
                  value={r.text}
                  onChange={(e) => setText(r.id, e.target.value)}
                  placeholder="Ex.: Evito tragédia, exceto quando o casal é forte."
                  rows={2}
                  maxLength={MAX_LEN}
                  className={cn("min-h-0 resize-none", !r.enabled && "opacity-60")}
                />
                <div className="mt-1 text-right text-[11px] text-muted-foreground/70">
                  {r.text.trim().length}/{MAX_LEN}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRule(r.id)}
                aria-label="Remover regra"
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={atCap}>
          <Plus className="size-4" /> Adicionar regra
        </Button>
        <span className="text-xs text-muted-foreground/70">
          {rules.length}/{MAX_RULES}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRules(initialRules)} disabled={isPending}>
              <Undo2 className="size-4" /> Desfazer
            </Button>
          )}
          <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || isPending}>
            <Save className="size-4" /> {isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  )
}
