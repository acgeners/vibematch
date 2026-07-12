"use server"

import { flareSolverrHealth, isFlareSolverrEnabled } from "@/lib/external/flaresolverr"
import { fetchMangagoById } from "@/lib/external/mangago"
import { fetchAnimePlanetByTitle } from "@/lib/external/animeplanet"
import { ensureAdmin } from "@/server/queries/current-user"

/**
 * Diagnóstico das fontes que SÓ passam via bypass do Cloudflare (Mangago, AnimePlanet).
 *
 * Por que este painel existe, separado do da Comix: aquele responde "a Comix está de pé?",
 * e nele o FlareSolverr é linha meramente informativa — porque a Comix responde em texto
 * puro e NÃO depende dele. Ninguém responde a outra pergunta: "as fontes que dependem do
 * bypass estão puxando dados agora?". Medido em 2026-07-12, o fetch direto do detalhe
 * devolve 403 `cf-mitigated: challenge` nas duas — sem bypass, elas simplesmente somem, e
 * a obra passa a mostrar o card "detalhes indisponíveis — fonte fora do ar".
 *
 * A pergunta certa é o DESFECHO, não a infra: checar só se o container do FlareSolverr
 * respira não prova nada (ele pode estar vivo e o solve falhando). Por isso o canário puxa
 * um detalhe real de cada fonte — se o Mangago responde, o bypass funciona por definição.
 * O status do FlareSolverr entra como linha própria porque, AQUI, ele é dependência: se
 * cair, as fontes vão junto e o canário reprova de verdade.
 */

interface SourceHealthCheck {
  ok: boolean
  /** Nome curto do que foi testado (ex.: "Mangago", "Bypass (FlareSolverr)"). */
  label: string
  /** Detalhe legível: título resolvido, versão, motivo da falha… */
  detail: string
  /** Latência em ms (omitido nos checks que não fazem rede pesada). */
  ms?: number
  /**
   * Linha que NUNCA reprova o painel (contexto, não veredito). Hoje só o sidecar: ele é a
   * camada 1 do bypass, mas nunca foi construído — sua ausência é normal, não é falha.
   */
  informational?: boolean
}

interface SourcesHealthResult {
  checks: SourceHealthCheck[]
  checkedAt: string
}

// Canários: obras populares e estáveis, pra o teste não quebrar porque um título obscuro
// saiu do ar. O slug é fixo de propósito — este painel testa a CONEXÃO, não o matching.
const MANGAGO_CANARY_SLUG = "solo_leveling"
const ANIMEPLANET_CANARY = { title: "Solo Leveling", slug: "solo-leveling" }

/** O processo do sidecar responde? Qualquer resposta HTTP (mesmo 404) prova que está de pé. */
async function sidecarAlive(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, { method: "GET", signal: AbortSignal.timeout(2000) })
    return res.status > 0
  } catch {
    return false
  }
}

export async function checkProtectedSourcesHealth(): Promise<SourcesHealthResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)

  const checkedAt = new Date().toISOString()
  const checks: SourceHealthCheck[] = []

  // 1. O bypass. Diferente do painel da Comix, aqui ele REPROVA: sem ele não há Mangago
  //    nem AnimePlanet, e é honesto o painel ficar vermelho quando os dados somem.
  const t0 = Date.now()
  const fs = isFlareSolverrEnabled()
    ? await flareSolverrHealth()
    : { ok: false, error: "FLARESOLVERR_URL não configurada" as string | undefined }
  checks.push({
    ok: fs.ok,
    label: "Bypass (FlareSolverr)",
    detail: fs.ok
      ? `único bypass ativo · v${("version" in fs && fs.version) || "?"} · sessões: ${
          "sessions" in fs && fs.sessions?.length ? fs.sessions.join(", ") : "nenhuma"
        }`
      : `fora — Mangago e AnimePlanet ficam indisponíveis (${fs.error ?? "não responde"})`,
    ms: Date.now() - t0,
  })

  // 2. Sidecar (camada 1) — informativo. O contrato e o cliente existem; o SERVIÇO nunca
  //    foi construído. Enquanto não subir, o FlareSolverr é ponto único de falha, e é isso
  //    que esta linha serve pra lembrar. Nunca reprova: a ausência dele é o estado normal.
  const sidecarUrl = process.env.COMIX_RENDER_URL?.trim() || ""
  checks.push({
    ok: true,
    informational: true,
    label: "Sidecar (camada 1)",
    detail: !sidecarUrl
      ? "não configurado — o FlareSolverr é o único bypass"
      : (await sidecarAlive(sidecarUrl))
        ? `de pé (${sidecarUrl}) — cobre o FlareSolverr se ele cair`
        : `configurado (${sidecarUrl}) mas fora — o FlareSolverr está sozinho`,
  })

  // 3-4. O desfecho: as fontes puxam dados AGORA? Em paralelo — são independentes, e o
  //      painel inteiro custa o tempo da mais lenta em vez da soma.
  const [mangago, animeplanet] = await Promise.all([
    (async () => {
      const t = Date.now()
      const detail = await fetchMangagoById(MANGAGO_CANARY_SLUG).catch(() => null)
      return { detail, ms: Date.now() - t }
    })(),
    (async () => {
      const t = Date.now()
      const detail = await fetchAnimePlanetByTitle(
        ANIMEPLANET_CANARY.title,
        ANIMEPLANET_CANARY.slug
      ).catch(() => null)
      return { detail, ms: Date.now() - t }
    })(),
  ])

  checks.push({
    ok: Boolean(mangago.detail?.title),
    label: "Mangago",
    detail: mangago.detail?.title
      ? `"${mangago.detail.title}"${mangago.detail.rating ? ` · nota ${mangago.detail.rating}` : ""}`
      : `canário "${MANGAGO_CANARY_SLUG}" não resolveu — detalhe indisponível`,
    ms: mangago.ms,
  })

  // O AnimePlanet só extrai nota/votos/capa/sinopse (não traz título), então o sinal de
  // vida é a nota. `fetchAnimePlanetByTitle` é o caminho que o app usa de verdade — inclusive
  // o abort default de 5s, sem sessão nomeada, que num solve FRIO do Cloudflare às vezes
  // estoura e devolve null. Testar por outro caminho daria um verde que o app não teria.
  const ap = animeplanet.detail
  checks.push({
    ok: ap?.rating != null,
    label: "AnimePlanet",
    detail:
      ap?.rating != null
        ? `nota ${ap.rating}${ap.votes ? ` · ${ap.votes.toLocaleString("pt-BR")} votos` : ""}`
        : `canário "${ANIMEPLANET_CANARY.slug}" não resolveu — detalhe indisponível`,
    ms: animeplanet.ms,
  })

  return { checks, checkedAt }
}
