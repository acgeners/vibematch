/**
 * Partes PURAS de `scripts/recalcular-vies-da-dona.ts` — a comparação gravado × recalculado e as
 * guardas. Ficam aqui para serem testadas sem banco (`tests/unit/scripts/recalcular-vies-da-dona.test.ts`).
 */

/** Uma linha de `attribute_bias`, como gravada (2 casas). */
export interface LinhaVies {
  attribute_slug: string
  n_samples: number
  mean_bias_raw: number
  bias_applied: number
  stddev_bias: number | null
}

const CAMPOS = ["n_samples", "mean_bias_raw", "bias_applied", "stddev_bias"] as const

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/** Duas linhas descrevem o MESMO viés? (`numeric` do PostgREST volta como string.) */
export function mesmoVies(a: LinhaVies | null, b: LinhaVies): boolean {
  if (!a) return false
  return CAMPOS.every((c) => num(a[c]) === num(b[c]))
}

export interface ComparacaoVies {
  slug: string
  antes: LinhaVies | null
  depois: LinhaVies
  muda: boolean
}

/** Para cada atributo RECALCULADO: o gravado, o novo e se muda. Slug gravado fora do cálculo não entra. */
export function compararVies(gravadas: LinhaVies[], novas: LinhaVies[]): ComparacaoVies[] {
  const porSlug = new Map(gravadas.map((r) => [r.attribute_slug, r]))
  return novas.map((depois) => {
    const antes = porSlug.get(depois.attribute_slug) ?? null
    return { slug: depois.attribute_slug, antes, depois, muda: !mesmoVies(antes, depois) }
  })
}

export interface EntradaGuardas {
  /** A conta principal pela régua do app (a linha mais antiga de `user_settings`). */
  donaId: string
  papel: string | null
  /** Amostras lidas pela leitura paginada. */
  lidas: number
  /** `count: exact` da mesma tabela/filtro — a prova de que a leitura não foi cortada. */
  contagemExata: number | null
  executar: boolean
  /** `--amostras=<n>`: o número que o ensaio imprimiu. */
  amostrasInformadas: number | null
  /** `--conta=<prefixo>`: o início do id que o ensaio imprimiu (≥ 8 caracteres). */
  contaInformada: string | null
}

/** Falhas de guarda. Qualquer uma ⇒ nada é gravado. */
export function conferirGuardasVies(e: EntradaGuardas): string[] {
  const falhas: string[] = []
  if (e.papel !== "curador") falhas.push(`a conta principal tem papel "${e.papel ?? "<sem linha>"}", não "curador"`)
  if (e.lidas <= 0) falhas.push("nenhuma amostra lida — não há o que recalcular")
  if (e.contagemExata == null || e.lidas !== e.contagemExata) {
    falhas.push(`leitura incompleta: ${e.lidas} amostras lidas, ${e.contagemExata ?? "?"} no banco`)
  }
  if (e.executar) {
    if (e.amostrasInformadas == null) falhas.push("--execute exige --amostras=<n> (o número que o ensaio imprimiu)")
    else if (e.amostrasInformadas !== e.lidas) falhas.push(`--amostras=${e.amostrasInformadas}, mas foram lidas ${e.lidas}`)
    if (e.contaInformada == null) falhas.push("--execute exige --conta=<prefixo do id> (o que o ensaio imprimiu)")
    else if (e.contaInformada.length < 8 || !e.donaId.startsWith(e.contaInformada)) {
      falhas.push(`--conta=${e.contaInformada} não é a conta principal (${e.donaId.slice(0, 8)}…)`)
    }
  }
  return falhas
}

/** Uma linha de `attribute_bias` de QUALQUER conta, para a conferência depois da escrita. */
export interface LinhaViesConta extends LinhaVies {
  user_id: string
  last_updated_at?: string | null
}

const chave = (r: LinhaViesConta) => `${r.user_id}|${r.attribute_slug}`
const assinatura = (r: LinhaViesConta) => JSON.stringify([r.n_samples, r.mean_bias_raw, r.bias_applied, r.stddev_bias, r.last_updated_at ?? null].map(String))

/**
 * Depois de gravar: nenhuma OUTRA conta mudou, os atributos da dona fora do cálculo ficaram como
 * estavam, e os recalculados têm exatamente o valor planejado. Falha ⇒ o operador restaura.
 */
export function conferirDepois(a: {
  donaId: string
  antes: LinhaViesConta[]
  depois: LinhaViesConta[]
  planejadas: LinhaVies[]
}): string[] {
  const falhas: string[] = []
  const recalculados = new Set(a.planejadas.map((p) => p.attribute_slug))
  const antes = new Map(a.antes.map((r) => [chave(r), r]))
  const depois = new Map(a.depois.map((r) => [chave(r), r]))
  for (const [k, r] of antes) {
    const intocavel = r.user_id !== a.donaId || !recalculados.has(r.attribute_slug)
    if (!intocavel) continue
    const d = depois.get(k)
    if (!d || assinatura(d) !== assinatura(r)) falhas.push(`linha que não devia mudar mudou: ${k}`)
  }
  for (const [k, d] of depois) {
    if (!antes.has(k) && (d.user_id !== a.donaId || !recalculados.has(d.attribute_slug))) {
      falhas.push(`linha nova fora do alvo: ${k}`)
    }
  }
  for (const p of a.planejadas) {
    const d = depois.get(`${a.donaId}|${p.attribute_slug}`)
    if (!d || !mesmoVies(d, p)) falhas.push(`${p.attribute_slug} da conta principal não ficou com o valor planejado`)
  }
  return falhas
}
