/**
 * Os fatos do pedido de curadoria que os DOIS lados precisam — sem `server-only`.
 *
 * 🔴 Isto não é organização: `server/queries/curation-requests.ts` abre com
 * `import "server-only"`, e o painel do leitor é `"use client"`. Um TIPO atravessa essa
 * fronteira de graça (`import type` some na compilação), mas um VALOR não — ele arrasta o
 * módulo inteiro para o bundle do browser e o `next build` reprova.
 *
 * ⚠️ E nem o `tsc` nem a suíte enxergam isso: os testes mockam `server-only`. Quem responde
 * é `npm run build`, e foi ele que pegou.
 */

/**
 * Os pedidos que o estado da obra NÃO expressa sozinho. Ver migration 177 (os três
 * primeiros) e 195 (`report_error`).
 */
export type CurationRequestKind =
  | "update_data"
  | "review_eval"
  | "create_by_name"
  | "report_error"

/**
 * Teto da nota, em caracteres. Espelha o check `curation_requests_note_tamanho` da 195 —
 * derivado por `tests/unit/orchestration/nota-do-pedido-tem-um-teto-so.test.ts`, senão a tela
 * prometeria um limite que o banco recusa e o texto se perderia no envio.
 *
 * 🔴 Ele é RECUSA, nunca corte. Truncar por unidade UTF-16 parte emoji ao meio e deixa
 * surrogate desemparelhado, que o Postgres recusa — foi o que derrubou duas escritas em
 * 18/08/2026 (ver `lib/text/pg-safe-text.ts`). Quem passar do teto recebe mensagem.
 */
export const CURATION_NOTE_MAX = 2000
