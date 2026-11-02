/**
 * Quando gravar "li hoje" (`last_read_at`) junto com os capítulos lidos.
 *
 * 🔴 Só o stepper da /reading e o formulário de status carimbavam a data. Criar a obra já com
 * capítulos lidos e editá-la pelo formulário completo gravavam os capítulos e deixavam a data
 * vazia — medido em 2026-11-02: 21 das 52 obras em leitura da dona estavam assim, e por isso
 * contavam como paradas. A regra é a mesma do `updateWorkStatus`: carimba quando o número CRESCE,
 * nunca ao corrigir um typo para baixo, e nunca por cima de uma data que veio no próprio patch.
 *
 * ⚠️ Importar lista NÃO passa por aqui de propósito: o capítulo importado foi lido em algum
 * momento que a lista não informa, e "hoje" seria uma data inventada.
 */
export function withReadDateStamp<T extends { chapters_read?: number | null; last_read_at?: string | null }>(
  patch: T,
  previousChapters: number | null | undefined,
  today: string,
): T {
  if (patch.last_read_at !== undefined) return patch
  const next = patch.chapters_read
  if (next == null || next <= 0) return patch
  if (previousChapters != null && next <= previousChapters) return patch
  return { ...patch, last_read_at: today }
}
