/**
 * Qual banco o app está usando — nuvem (produção) ou o stack local do `supabase start`.
 *
 * Desde 2026-08-10 a NUVEM é a fonte de verdade e o local é réplica descartável. O app segue o
 * `.env.local`, que aponta pra nuvem; quem vai pro local são os 25 scripts de análise, por um
 * `.env.analysis` carregado por cima na linha de comando.
 *
 * ⚠️ `scripts/db-target.mjs` tem a própria cópia deste teste — ele é `.mjs` de linha de comando
 * e não importa TS do app. É a única duplicação aceita aqui, e ela é de UMA regex trivial: se
 * um dia a forma de detectar o alvo ficar mais complicada que "o host é local?", as duas
 * precisam voltar a ser uma só.
 */

/** Aceita `127.0.0.1` e `localhost` — o `supabase status` devolve o primeiro, mas o segundo
 *  aparece quando alguém edita o `.env` à mão, e tratar só um deixaria o aviso mudo. */
export function isLocalSupabaseUrl(url = process.env.NEXT_PUBLIC_SUPABASE_URL): boolean {
  return /127\.0\.0\.1|localhost/.test(url ?? "")
}

/** Rótulo curto para a tela: `127.0.0.1:54321`. Cai para a URL crua se não parsear. */
export function supabaseTargetLabel(url = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  if (!url) return "(sem alvo)"
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
