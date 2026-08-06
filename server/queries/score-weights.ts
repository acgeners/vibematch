import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { HighlightWeight } from "@/lib/ranking/criterion-highlights"

/**
 * Pesos ativos dos 9 atributos — os mesmos que o `calculateGPT` usa.
 *
 * ⚠️ `score_weights` é uma tabela **COMPARTILHADA**, não per-usuário (ver o
 * cabeçalho de `server/actions/settings.ts`). Quem lê isto está lendo os pesos
 * DECLARADOS PELO DONO, para qualquer visitante.
 *
 * Isso NÃO é um vazamento novo: o recalc per-usuário (`server/recalc/user-recalc.ts`)
 * já lê esta mesma tabela global para calcular a Nota.IA de todo mundo. O ▲/▼ dos
 * atributos em destaque herda exatamente a mesma limitação dos números que já estão
 * no card — nem mais, nem menos. Quando a Fase 3 tornar os pesos per-usuário, este
 * leitor acompanha e o marcador passa a valer para cada um.
 * Ver [[project_attribute_bias_multiuser_fase3]].
 *
 * NÃO PODE LANÇAR: é decoração de um card que funciona sem ela (sem pesos, o chip
 * fica sem o ▲/▼ e mostra só a direção). O /ranking chama dentro de um Promise.all —
 * um throw aqui derrubaria a página inteira por causa de um marcador.
 */
export async function getHighlightWeightsSafe(): Promise<HighlightWeight[] | null> {
  try {
    const supabase = createAdminClient()
    // 9 linhas; sem paginação de propósito (bem abaixo do corte de 1000).
    const { data, error } = await supabase
      .from("score_weights")
      .select("slug, weight, threshold, is_active")
      .eq("is_active", true)
    if (error) throw error
    return data?.length ? (data as HighlightWeight[]) : null
  } catch (error) {
    console.error("[score-weights] pesos indisponíveis:", error)
    return null
  }
}
