import { AI_OPERATION_KEYS, AI_OPERATIONS } from "@/lib/ai-observability/types"
import { CachePill, ModelPill, RetiredPill, WorkloadPill } from "./pills"

/**
 * Glossário de TODAS as operações conhecidas — gerado direto do catálogo
 * AI_OPERATIONS (nome, chave, modelo padrão, workload típico, cache, descrição).
 * Server component: conteúdo estático, sem interação.
 */
export function OperationsGlossary() {
  return (
    <div className="divide-y divide-border/50">
      {AI_OPERATION_KEYS.map((key) => {
        const def = AI_OPERATIONS[key]
        return (
          <div key={key} className="grid gap-1.5 py-3 sm:grid-cols-[220px_1fr] sm:gap-5">
            <div>
              <p className="text-[13px] font-semibold text-foreground">{def.label}</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{key}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {def.status === "active" ? <ModelPill model={def.defaultModel} /> : <RetiredPill />}
                <WorkloadPill workload={def.typicalWorkload} />
                {def.hasResultCache && <CachePill />}
              </div>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">{def.description}</p>
          </div>
        )
      })}
    </div>
  )
}
