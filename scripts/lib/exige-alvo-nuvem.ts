/**
 * Barra execução PAGA contra o banco local.
 *
 * Por que existe: desde o cutover de 2026-08-10 a NUVEM é a fonte de verdade e o local é
 * réplica descartável. Um script que chama a IA e grava o resultado no local **paga igual e
 * perde tudo** no próximo `db:pull` — as chamadas Claude custam o mesmo contra qualquer
 * banco, então "ensaiar barato no local" não existe. Quem limita o dano de verdade é o
 * `--max-cost-usd`, não o alvo.
 *
 * Medido em 2026-08-10, o que estava em jogo: `backfill:interest --execute` planejava **971
 * previsões, US$10,60** (teto US$15,89), e `e1:digest` tinha 136 obras a US$0,0183 cada. O
 * npm script dos dois carregava `--env-file=.env.analysis`, ou seja, apontava pro local — e
 * o dry-run do primeiro **imprimia esse comando** como o passo seguinte.
 *
 * 🔴 O arranjo era o pior dos quatro possíveis: o executor de Interesse replaneja e compara
 * (`plan.planSignature !== deps.planSignature` ⇒ `plan_changed`), então planejar num banco e
 * executar no outro ABORTA. O único par que "funcionava" era local+local, que é justamente o
 * que queima dinheiro à toa.
 *
 * ⚠️ Esta é a 2ª camada. A 1ª é o `package.json` não carregar `.env.analysis` nesses dois
 * scripts. As duas existem porque são portas diferentes: quem copia o comando do cabeçalho
 * não passa pelo npm script.
 */
export function exigeAlvoNuvem(comandoCerto: string): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (!/127\.0\.0\.1|localhost/.test(url)) return

  console.error(
    [
      "",
      "🔴 --execute apontando para o banco LOCAL. Abortado antes de qualquer chamada paga.",
      "",
      `   alvo detectado: ${url}`,
      "",
      "   As chamadas de IA custam o mesmo contra qualquer banco, e o resultado gravado",
      "   aqui morre no próximo `db:pull` — você pagaria para jogar fora. A execução paga",
      "   tem que rodar contra a NUVEM, que é a fonte de verdade.",
      "",
      "   Rode sem o `.env.analysis`:",
      `     ${comandoCerto}`,
      "",
    ].join("\n"),
  )
  process.exit(1)
}
