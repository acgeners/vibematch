/**
 * Plano PURO da carga da classificação etária (`scripts/carregar-classificacao-etaria.ts`) — separado
 * para ser testado sem banco.
 */
import { decideAdultAuto } from "@/lib/tags/adult-classify"
import { parseAgeRating } from "@/lib/age-rating/age-rating"
import type { AgeRating, AgeRatingVersion } from "@/lib/age-rating/age-rating"

/** Uma linha do arquivo gerado pela auditoria (`carga-classificacao.json`). */
export interface LinhaCarga {
  work_id: string
  title: string
  versao: AgeRatingVersion
  faixa: number | null
  conflito: string | null
  evidencia: Record<string, unknown>
  edition_state_auditado: string | null
}

export interface ObraAtual {
  id: string
  edition_state: string | null
  adult_auto: boolean
  adult_reason: string | null
  adult_override?: boolean | null
  is_adult?: boolean
}

/**
 * O `is_adult` que a coluna gerada vai produzir (mig 204): override vence; mixed não liga; r18_only e
 * unknown ligam; senão o `adult_auto`. Só para o RELATÓRIO da carga — quem decide é o banco.
 */
export function isAdultEfetivo(o: ObraAtual, adultAuto: boolean): boolean {
  if (o.adult_override != null) return o.adult_override
  if (o.edition_state === "mixed") return false
  if (o.edition_state === "r18_only" || o.edition_state === "unknown") return true
  return adultAuto
}

export interface LinhaGravada {
  work_id: string
  versao: AgeRatingVersion
  faixa: AgeRating | null
  conflito: string | null
  evidencia: Record<string, unknown>
  decidido_por: "auditoria" | "curadoria"
}

export interface Pulada {
  work_id: string
  title: string
  versao: string
  motivo: string
}

export interface PlanoCarga {
  lidas: number
  existentes: number
  versaoCompativel: number
  livresDeCuradoria: number
  gravar: LinhaGravada[]
  iguais: number
  puladas: Pulada[]
}

const chave = (workId: string, versao: string) => `${workId}:${versao}`

const mesmaLinha = (a: LinhaGravada, b: LinhaGravada) =>
  a.faixa === b.faixa && a.conflito === b.conflito && JSON.stringify(a.evidencia) === JSON.stringify(b.evidencia)

/**
 * Decide o que gravar. Regras:
 * - obra que não existe mais: pula;
 * - linha `obra` numa obra que HOJE é mixed, ou `normal` numa que deixou de ser: pula (a estrutura mudou
 *   depois da auditoria — a faixa foi medida para outra pergunta);
 * - linha já decidida pela CURADORIA: nunca é sobrescrita;
 * - linha igual à gravada: não regrava.
 */
export function planejarCarga(
  linhas: ReadonlyArray<LinhaCarga>,
  obras: ReadonlyMap<string, ObraAtual>,
  gravadas: ReadonlyMap<string, LinhaGravada>,
): PlanoCarga {
  const puladas: Pulada[] = []
  const gravar: LinhaGravada[] = []
  let existentes = 0
  let versaoCompativel = 0
  let livresDeCuradoria = 0
  let iguais = 0
  const vistas = new Set<string>()
  for (const l of linhas) {
    const k = chave(l.work_id, l.versao)
    if (vistas.has(k)) throw new Error(`linha repetida no arquivo: ${k}`)
    vistas.add(k)
    const faixa = l.faixa == null ? null : parseAgeRating(l.faixa)
    if (l.faixa != null && faixa == null) throw new Error(`faixa inválida no arquivo (${k}): ${l.faixa}`)
    if (l.versao !== "obra" && l.versao !== "normal") throw new Error(`versão inválida no arquivo (${k}): ${l.versao}`)

    const obra = obras.get(l.work_id)
    if (!obra) {
      puladas.push({ work_id: l.work_id, title: l.title, versao: l.versao, motivo: "obra não existe mais" })
      continue
    }
    existentes++
    const mixedHoje = obra.edition_state === "mixed"
    if ((l.versao === "obra") === mixedHoje) {
      puladas.push({
        work_id: l.work_id,
        title: l.title,
        versao: l.versao,
        motivo: `estrutura mudou: auditada como ${l.edition_state_auditado ?? "sem estado"}, hoje ${obra.edition_state ?? "sem estado"}`,
      })
      continue
    }
    versaoCompativel++
    const atual = gravadas.get(k)
    if (atual?.decidido_por === "curadoria") {
      puladas.push({ work_id: l.work_id, title: l.title, versao: l.versao, motivo: "já decidida pela curadoria" })
      continue
    }
    livresDeCuradoria++
    const nova: LinhaGravada = {
      work_id: l.work_id,
      versao: l.versao,
      faixa,
      conflito: l.conflito && l.conflito.trim() ? l.conflito : null,
      evidencia: l.evidencia ?? {},
      decidido_por: "auditoria",
    }
    if (atual && mesmaLinha(atual, nova)) {
      iguais++
      continue
    }
    gravar.push(nova)
  }
  return { lidas: linhas.length, existentes, versaoCompativel, livresDeCuradoria, gravar, iguais, puladas }
}

export interface MudancaGate {
  work_id: string
  antes: { adult_auto: boolean; adult_reason: string | null }
  depois: { adult_auto: boolean; adult_reason: string | null }
}

/**
 * O gate 18+ que a carga vai produzir, pela MESMA régua do app (`decideAdultAuto`): obra com linha
 * `obra` faixa 18 liga (`official_rating`); obra que estava ligada por `official_rating` e perdeu a
 * faixa 18 desliga.
 */
export function planejarGate(
  candidatas: ReadonlyArray<string>,
  obras: ReadonlyMap<string, ObraAtual>,
  temForte: ReadonlySet<string>,
  faixaObraFinal: ReadonlyMap<string, AgeRating | null>,
): MudancaGate[] {
  const out: MudancaGate[] = []
  for (const id of candidatas) {
    const o = obras.get(id)
    if (!o) continue
    const antes = { adult_auto: o.adult_auto, adult_reason: o.adult_reason }
    const d = decideAdultAuto(antes, temForte.has(id), faixaObraFinal.get(id) === 18)
    if (d) out.push({ work_id: id, antes, depois: d })
  }
  return out
}
