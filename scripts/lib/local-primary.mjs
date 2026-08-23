/**
 * LOCAL PRIMARY MODE — o banco LOCAL passa a ser a fonte da verdade TEMPORÁRIA.
 *
 * Existe por causa de uma inversão de premissa. Todo o repositório foi construído sobre
 * "a nuvem é a verdade, o local é réplica DESCARTÁVEL" — e é isso que autoriza `db:pull` a
 * destruir os schemas `public` e `bkp` do local sem perguntar nada. Quando a quota de egress
 * da nuvem estoura e o trabalho passa a acontecer no local, essa mesma linha vira o comando
 * que apaga semanas de curadoria.
 *
 * 🔴 O sentinela NÃO é documentação: é o que faz o `db:pull` recusar. Enquanto ele existir,
 * qualquer operação destrutiva sobre o local exige intenção explícita.
 *
 * Ciclo de vida:
 *   npm run db:local-primary on    → ativa (grava o sentinela)
 *   npm run db:local-primary       → mostra o estado
 *   npm run db:local-primary off   → desativa (depois da promoção LOCAL → CLOUD)
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
export const SENTINELA = path.join(ROOT, ".local-primary")

/**
 * Um alvo é local? Dono ÚNICO do predicado — `scripts/smoke-logado.mjs` reexporta daqui.
 * Duas grafias desta regex fariam um script recusar o que o outro aceita.
 */
export const ehLocal = (u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u ?? "")

/** Estado do sentinela, ou `null` quando LOCAL PRIMARY está desligado. */
export function lerSentinela() {
  try {
    return JSON.parse(fs.readFileSync(SENTINELA, "utf8"))
  } catch {
    return null
  }
}

export const localPrimaryAtivo = () => lerSentinela() != null

/**
 * Recusa uma operação DESTRUTIVA sobre o banco local enquanto LOCAL PRIMARY estiver ativo.
 *
 * ⚠️ A flag de override é a MESMA do `db:push-curation` (`--eu-sei-o-que-estou-fazendo`) de
 * propósito: uma segunda grafia para "sim, eu quero mesmo" é uma segunda coisa para lembrar.
 */
export function exigirIntencaoParaDestruir({ comando, oQueDestroi, argv = process.argv }) {
  const s = lerSentinela()
  if (!s) return

  if (argv.includes("--eu-sei-o-que-estou-fazendo")) {
    console.warn(`\n⚠️  LOCAL PRIMARY ATIVO e override aceito — ${oQueDestroi}`)
    console.warn(`   ativo desde ${s.ativadoEm}; último backup registrado: ${s.ultimoBackup ?? "NENHUM"}\n`)
    return
  }

  console.error(`\n🔴 RECUSADO — LOCAL PRIMARY está ativo desde ${s.ativadoEm}.`)
  console.error(`\n   ${comando} ${oQueDestroi}.`)
  console.error(`   Enquanto LOCAL PRIMARY estiver ativo, o banco LOCAL é a fonte da verdade:`)
  console.error(`   ele contém curadoria, estado de leitura, listas e avaliações que NÃO existem`)
  console.error(`   em outro lugar. A nuvem é um snapshot CONGELADO de ${s.snapshotDe ?? "?"}.`)
  console.error(`\n   Último backup local registrado: ${s.ultimoBackup ?? "🔴 NENHUM"}`)
  console.error(`\n   Antes de destruir, faça uma das duas:`)
  console.error(`     npm run db:local:backup            # preserva o estado atual`)
  console.error(`     npm run db:local-primary off       # encerra o modo (após promover pra nuvem)`)
  console.error(`\n   Se você realmente quer destruir mesmo assim:`)
  console.error(`     ${comando} --eu-sei-o-que-estou-fazendo\n`)
  process.exit(1)
}

/**
 * Recusa quando o alvo configurado NÃO é local durante LOCAL PRIMARY.
 *
 * 🔴 O caso concreto que isto impede está medido: em 22/08/2026, com a nuvem já restrita por
 * quota, o `.env.local` ainda apontava para PRODUÇÃO — ou seja, cada `npm run dev` seguia
 * batendo no banco remoto (toda rota é `force-dynamic`). Sem esta guarda, ativar LOCAL PRIMARY
 * e esquecer o `db:local` mantém exatamente a sangria que motivou o modo.
 */
export function exigirAlvoLocal({ contexto, url = process.env.NEXT_PUBLIC_SUPABASE_URL }) {
  if (!localPrimaryAtivo()) return
  if (ehLocal(url)) return

  console.error(`\n🔴 RECUSADO — LOCAL PRIMARY ativo, mas ${contexto} aponta para ${url || "(vazio)"}.`)
  console.error(`   Esse não é o stack local. Rode:  npm run db:local\n`)
  process.exit(1)
}

/** Registra o backup mais recente no sentinela — é o que a mensagem de recusa mostra. */
export function registrarBackup(caminho) {
  const s = lerSentinela()
  if (!s) return
  fs.writeFileSync(SENTINELA, JSON.stringify({ ...s, ultimoBackup: caminho }, null, 2) + "\n")
}
