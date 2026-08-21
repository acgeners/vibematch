import type { WorkCover } from "@/types/domain"
import { pickPrimaryCover as pickPrimaryCoverOwner } from "@/lib/work-derived"

/** Aceita tanto WorkCover completo quanto seleções parciais (ex.: dashboard). */
type CoverLike = Pick<WorkCover, "url" | "is_primary"> & { position?: number | null }

/**
 * Escolhe a URL da capa primária de uma obra. **DERIVA** de `lib/work-derived`,
 * que é o dono da ordem — aqui só sobrou o ponto de entrada, porque 8 arquivos já
 * importavam por este caminho.
 *
 * 🔴 Até 2026-08-20 esta função tinha régua PRÓPRIA (`find(is_primary) ?? covers[0]`,
 * sem olhar `position`) enquanto a homônima de `work-derived` ordenava por
 * `is_primary` e depois `position`. Duas funções, mesmo nome, resultados que podem
 * diferir — a família "dois critérios pro mesmo fato", aqui decidindo qual capa a
 * obra mostra em cada tela.
 *
 * ⚠️ Elas NÃO divergiam na prática, e isso é medição, não sorte: as duas só
 * discordam quando a obra não tem exatamente uma capa marcada, e o índice parcial
 * `work_covers_one_primary` impede a segunda. Medido no clone local em 2026-08-20:
 * 988 obras com capa, **0** na condição de divergir (1 sem primária, e essa tem uma
 * capa só). Era dívida, não defeito — e foi fechada enquanto ainda era dívida.
 */
export function pickPrimaryCover(covers: CoverLike[] | null | undefined): string | null {
  return pickPrimaryCoverOwner(covers)
}
