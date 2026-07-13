import "server-only"
import { createClient } from "@/lib/supabase/server"

/**
 * Cliente do USUÁRIO (anon key + sessão dos cookies) — **a RLS vale**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Qual cliente usar?
 * ─────────────────────────────────────────────────────────────────────────────
 *  `createUserClient()`   → dado PER-USUÁRIO escrito a partir de uma requisição.
 *                           O Postgres filtra por você (`user_id = auth.uid()`).
 *                           Se o código esquecer o `.eq("user_id", …)`, ou passar
 *                           o id de outra pessoa, a escrita é NEGADA — não vira
 *                           dado errado em silêncio.
 *
 *  `createAdminClient()`  → catálogo (works, tags, reviews…), curadoria, e
 *                           qualquer coisa que rode SEM sessão: fila de recalc,
 *                           `after()`, cascatas, scripts. Ignora RLS **por
 *                           definição** — o `user_id` tem que vir explícito no
 *                           argumento, nunca implícito no "usuário corrente".
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por que não mover TUDO pra cá: o recalc lê `attribute_bias` e
 * `user_tag_preferences` do dono **em background, sem sessão**. Com este cliente
 * ele veria zero linhas e recalcularia as notas do dono **sem a calibração dele**
 * — sem erro, sem log, só notas erradas. Leitura de background continua na
 * service role, com o `user_id` explícito.
 *
 * Ver `supabase/migrations/142_rls_per_user_tables.sql`.
 */
export async function createUserClient() {
  return createClient()
}
