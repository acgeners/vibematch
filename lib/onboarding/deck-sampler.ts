/**
 * Amostrador do deck do onboarding — decisão travada (2026-07-31): as 30 obras são uma
 * AMOSTRA QUE COBRE OS GÊNEROS escolhidos na tela de gostos (round-robin entre eles,
 * mais popular primeiro dentro de cada um); quem pulou a tela cai no fallback: as mais
 * populares do catálogo. Ensina mais por toque que 30 populares parecidas entre si —
 * o preditor de Interesse é treinado em sinopse, e rótulo espalhado por gênero vale mais.
 *
 * Puro de propósito (recebe candidatos já filtrados; não toca banco): é a parte com
 * regra, e é isto que os testes cobrem. Quem filtra (sinopse primária presente, capa,
 * 18+ conforme a escolha da tela 2, obras que o usuário já tem) é o caller.
 */

export interface DeckCandidate {
  id: string
  /** Gêneros da obra (nomes, como em `genres.name`). */
  genres: string[]
  /** Proxy de popularidade (ex.: soma de votos das plataformas). Maior = mais popular. */
  popularity: number
}

/**
 * Round-robin pelos gêneros amados: 1º mais popular de cada gênero, depois o 2º de
 * cada, … até `limit`. Obra com dois gêneros amados entra UMA vez (no primeiro em que
 * for escolhida). Sobrou vaga (gêneros esgotados)? Completa por popularidade global.
 * Determinístico: empata por id — testável e estável entre renders.
 */
export function pickDeckWorks(
  candidates: DeckCandidate[],
  lovedGenres: string[],
  limit = 30,
): string[] {
  const byPopularity = [...candidates].sort(
    (a, z) => z.popularity - a.popularity || (a.id < z.id ? -1 : 1),
  )

  const picked: string[] = []
  const taken = new Set<string>()
  const take = (c: DeckCandidate | undefined) => {
    if (!c || taken.has(c.id) || picked.length >= limit) return
    taken.add(c.id)
    picked.push(c.id)
  }

  const loved = lovedGenres.filter(Boolean)
  if (loved.length > 0) {
    // Fila por gênero, já ordenada por popularidade.
    const queues = new Map<string, DeckCandidate[]>(
      loved.map((g) => [g, byPopularity.filter((c) => c.genres.includes(g))]),
    )
    const cursors = new Map<string, number>(loved.map((g) => [g, 0]))

    let progressed = true
    while (picked.length < limit && progressed) {
      progressed = false
      for (const g of loved) {
        if (picked.length >= limit) break
        const queue = queues.get(g)!
        let i = cursors.get(g)!
        // avança o cursor por cima das já escolhidas (por outro gênero)
        while (i < queue.length && taken.has(queue[i].id)) i++
        if (i < queue.length) {
          take(queue[i])
          cursors.set(g, i + 1)
          progressed = true
        } else {
          cursors.set(g, i)
        }
      }
    }
  }

  // Fallback / completa por popularidade global.
  for (const c of byPopularity) {
    if (picked.length >= limit) break
    take(c)
  }

  return picked
}
