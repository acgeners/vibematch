import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Healthcheck que EXERCITA O BANCO.
 *
 * Existe por causa de uma falha real: entre 2026-07-31 e 08-03 produção ficou inteira no ar
 * respondendo HTTP 200 enquanto TODA leitura do banco falhava com `Invalid API key` — o
 * `SUPABASE_SERVICE_ROLE_KEY` da Fly não valia para o projeto. Ninguém percebeu por três dias
 * porque o smoke da época testava `/sobre` e `/`, as duas rotas que não tocam o banco.
 *
 * ⚠️ Por que `curl -o /dev/null -w %{http_code}` numa página normal NÃO serve de monitor: com
 * Suspense o Next envia o shell com 200 e só depois falha durante o streaming. O status já foi
 * escrito quando o erro acontece, então a página quebrada responde 200 igual à saudável. Aqui a
 * resposta só é montada DEPOIS da query, e o status reflete o resultado dela.
 *
 * A query é `count: "exact", head: true`: devolve o número no header e ZERO bytes de corpo, então
 * monitorar de 6 em 6 horas não consome a quota de egress (5 GB/ciclo no plano free).
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const t0 = Date.now()

  try {
    const supabase = createAdminClient()
    const { count, error } = await supabase
      .from("works")
      .select("*", { count: "exact", head: true })
      .eq("is_archived", false)

    if (error) {
      // Mensagem crua do PostgREST fica no log do servidor; a resposta é pública (repo aberto),
      // então sai só o suficiente para alguém saber ONDE olhar.
      console.error("[health] falha lendo works:", error.message)
      return NextResponse.json(
        { ok: false, check: "db", detail: "query falhou", ms: Date.now() - t0 },
        { status: 503 },
      )
    }

    // Catálogo vazio não é "saudável": significa credencial trocada, RLS inesperada ou banco
    // errado — casos em que a query "funciona" e devolve nada. Um monitor que aceita 0 aqui
    // repete o erro que este arquivo existe para evitar.
    if (!count || count === 0) {
      console.error("[health] catálogo vazio — credencial ou projeto errado?")
      return NextResponse.json(
        { ok: false, check: "db", detail: "catálogo vazio", ms: Date.now() - t0 },
        { status: 503 },
      )
    }

    return NextResponse.json({ ok: true, works: count, ms: Date.now() - t0 })
  } catch (e) {
    console.error("[health] exceção:", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, check: "exception", ms: Date.now() - t0 },
      { status: 503 },
    )
  }
}
