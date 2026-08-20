/**
 * Dono ÚNICO da política de retenção de `.backups/`.
 *
 * ## Por que existe
 *
 * Em 2026-08-10 o `.backups` estava em **1,9 GB**, dos quais 1,5 GB eram 23 diretórios
 * `push-curation-*` — quase todos de um único dia, a maioria ENSAIO no cloudsim. Disco cheio
 * já derrubou a VM do Docker aqui, e é o Docker que segura o Supabase local.
 *
 * 🔴 A causa não foi "faltou retenção no push-curation". Foi que **cada script inventava seu
 * próprio prefixo e sua própria política**, e cada retenção era escrita como um regex que só
 * enxerga a própria família:
 *
 *     backup-db.mjs          /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/
 *     db-pull-to-local.mjs   /^pull-\d{4}-...T/
 *     db-push-new-works.mjs  /^new-works-\d{4}-...T/
 *
 * Nenhuma delas erra — todas são corretas e todas são cegas para as outras **por construção**.
 * Um prefixo novo nasce sem dono e ninguém percebe. Medido: de 7 scripts que gravavam ali, 3
 * nunca podavam nada, e havia 3 entradas órfãs de script nenhum (uma delas de **33 MB**).
 *
 * É a mesma armadilha que esta base já documenta em `LOW_BALANCE_USD` (2 cópias),
 * `STRONG_TAG_WEIGHT` (2 cópias) e dinheiro (6 arquivos, 8 funções). Aqui ela aparece em
 * disco em vez de em tela — e o sintoma demora meses, porque disco só dói quando acaba.
 *
 * ⚠️ **A âncora do CLAUDE.md enganava.** Ele dizia "depois de um backup bem-sucedido o script
 * mantém os 5 mais recentes", o que é verdade e leva à conclusão falsa de que `.backups` está
 * sob controle. Essa frase cobria 6 dos 40 diretórios.
 *
 * ## Como usar
 *
 *     import { podar } from "./lib/backups-retencao.mjs"
 *     podar("push-curation")   // poda a própria família e denuncia entradas sem dono
 *
 * Ao criar um script que grave em `.backups`, **declare a família aqui**. Não é burocracia: é
 * o que faz `entradasSemDono()` parar de gritar, e é o que o teste de arquitetura
 * (`tests/unit/orchestration/backups-retencao-tem-dono.test.ts`) exige.
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
export const BASE = path.join(ROOT, ".backups")

/**
 * Toda família que pode existir em `.backups`, com quem a cria e quantas se guarda.
 *
 * 🔴 `casa` tem que ser MUTUAMENTE EXCLUSIVO. A armadilha concreta: um teste ingênuo de
 * prefixo para `push-` engoliria `push-curation-` e o staging de 96 MB seria podado pela
 * política de 3 do outro (ou, pior, contado como "os 3 mais recentes" do vizinho e mantido
 * para sempre). Por isso todo regex datado exige o dígito do ano LOGO depois do prefixo:
 * `push-curation-…` não casa com `/^push-\d{4}/`. Guardado por teste.
 *
 * `keep: null` = diretório fixo, não acumula versões — tem dono, mas não se poda.
 *
 * 🔴 `exemplo` NÃO é dado morto: é o nome de diretório real que o teste de arquitetura usa
 * para provar duas coisas de uma vez — que `casa` reconhece a PRÓPRIA família e que nenhuma
 * outra o reconhece junto. Ele mora aqui, encostado no regex, porque já morou numa lista fixa
 * dentro do teste (escrita DUAS vezes, em funções vizinhas): família nova exigia lembrar de
 * dois lugares que nada ligava um ao outro, e a primeira a entrar depois disso (`normalizar-titulos`,
 * então em outra branch) entrou sem que ninguém lembrasse — a suíte ficou vermelha sem que
 * houvesse defeito nenhum na família. Ao declarar uma família, escreva aqui um nome que o
 * `casa` dela aceite.
 */
export const FAMILIAS = [
  {
    id: "backup",
    dono: "backup-db.mjs",
    oQueE: "dump lógico NDJSON de todas as tabelas — o backup de DADO (sem schema/policies)",
    casa: (n) => /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(n),
    exemplo: "2026-08-10T15-46-58-638Z",
    keepPadrao: 5,
    env: "BACKUP_KEEP",
  },
  {
    id: "pull",
    dono: "db-pull-to-local.mjs",
    // Guardamos mais destes do que o tamanho sugere: é o ÚNICO backup do projeto que inclui
    // schema, policies e functions — o NDJSON do backup-db.mjs não os tem.
    oQueE: "pg_dump da nuvem — único backup COM schema, policies e functions",
    casa: (n) => /^pull-\d{4}-\d{2}-\d{2}T/.test(n),
    exemplo: "pull-2026-07-30T00-31-49-679Z",
    keepPadrao: 3,
    env: "PULL_KEEP",
  },
  {
    id: "backfill-tags",
    dono: "backfill-external-tags-map.ts",
    // 🔴 Escapou da varredura por ANOS porque o teste só reconhecia a string `".backups"`
    // fechada, e este script usa `".backups/backfill-tags"`. Diretório fixo com um JSON por
    // execução — ao contrário das famílias datadas, aqui a poda não remove nada; o valor de
    // declarar é o `podar()` parar de acusá-lo como órfão e o próximo leitor saber quem grava.
    oQueE: "mapa de tags externas → internas gerado pelo backfill (um JSON por execução)",
    casa: (n) => n === "backfill-tags",
    exemplo: "backfill-tags",
    keepPadrao: 1,
    env: "BACKFILL_TAGS_KEEP",
  },
  {
    id: "fix-external-ids",
    dono: "fix-external-ids-compartilhados.ts",
    // Um diretório DATADO por execução, com o snapshot das linhas ANTES da correção.
    // Pequeno (poucos KB), mas é a única rede para desfazer: o banco não tem PITR.
    // ⚠️ Datado, e não um diretório fixo: `podar` ordena por stamp e corta o excedente —
    // uma entrada só nunca seria podada e a "retenção" seria decorativa.
    oQueE: "estado anterior das linhas corrigidas (ids externos trocados)",
    casa: (n) => /^fix-external-ids-\d{4}/.test(n),
    exemplo: "fix-external-ids-2026-08-14T00-15-58-115Z",
    keepPadrao: 10,
    env: "FIX_IDS_KEEP",
  },
  {
    id: "repick-cover",
    dono: "repick-dead-covers.ts",
    // Datado, como o `fix-external-ids`: um diretório por execução com o estado ANTERIOR
    // de `work_covers.is_primary`. Poucos KB, e é a única forma de desfazer — o banco não
    // tem PITR. Guardamos bastante porque só se descobre que a repescagem errou quando
    // alguém olha a capa, o que pode demorar.
    oQueE: "estado anterior de is_primary ao repescar capa morta",
    casa: (n) => /^repick-cover-\d{4}/.test(n),
    exemplo: "repick-cover-2026-08-15T03-11-22-333Z",
    keepPadrao: 10,
    env: "REPICK_COVER_KEEP",
  },
  {
    id: "adult-content-razao",
    dono: "adult-content-retroactive-bounds.ts",
    // Datado, um diretório por execução com o par (antes, depois) de cada JUSTIFICATIVA
    // tocada. Alguns KB. É a única forma de desfazer — o banco não tem PITR —, e aqui o
    // texto original é irreconstruível: ele é a saída de um modelo que já não roda com
    // aquele prompt, e reavaliar produziria outra prosa, não a mesma.
    oQueE: "justificativa anterior das notas de adult_content que ganharam a razão do limite",
    casa: (n) => /^adult-content-razao-\d{4}/.test(n),
    exemplo: "adult-content-razao-2026-08-20T05-42-10-123Z",
    keepPadrao: 10,
    env: "ADULT_CONTENT_RAZAO_KEEP",
  },
  {
    id: "normalizar-titulos",
    dono: "normalizar-titulos.ts",
    // Datado, um diretório por execução com o par (antes, depois) de cada obra tocada.
    // Alguns KB. É a única forma de desfazer — o banco não tem PITR —, e desfazer aqui é
    // caro de reconstruir de cabeça: ninguém lembra qual era a caixa original.
    oQueE: "título anterior das obras normalizadas (espaço nas pontas + caixa)",
    casa: (n) => /^normalizar-titulos-\d{4}/.test(n),
    exemplo: "normalizar-titulos-2026-08-17T03-11-22-333Z",
    keepPadrao: 10,
    env: "NORMALIZAR_TITULOS_KEEP",
  },
  {
    id: "normalizar-titulos-alternativos",
    dono: "normalizar-titulos-alternativos.ts",
    // Datado, um diretório por execução com a lista ANTES e DEPOIS de cada obra tocada.
    // Alguns KB. É a única forma de desfazer — o banco não tem PITR —, e reconstruir de
    // cabeça é impossível: ninguém lembra em que ordem os aliases estavam.
    //
    // ⚠️ O prefixo é MAIOR que o da família `normalizar-titulos`, e as duas continuam
    // mutuamente exclusivas porque lá o dígito do ano vem logo depois do prefixo:
    // `normalizar-titulos-alternativos-…` tem um "a" naquela posição.
    oQueE: "lista anterior de títulos alternativos das obras normalizadas",
    casa: (n) => /^normalizar-titulos-alternativos-\d{4}/.test(n),
    exemplo: "normalizar-titulos-alternativos-2026-08-18T03-11-22-333Z",
    keepPadrao: 10,
    env: "NORMALIZAR_ALT_TITULOS_KEEP",
  },
  {
    id: "push-opening-structure",
    dono: "push-opening-structure.ts",
    oQueE: "estado anterior da nuvem ao resgatar estrutura de abertura do local",
    // ⚠️ O dígito logo após o prefixo é o que impede a família `push-evals` (/^push-\d{4}/)
    // de engolir estas entradas — e vice-versa. Famílias têm de ser mutuamente exclusivas.
    casa: (n) => /^push-opening-structure-\d{4}/.test(n),
    exemplo: "push-opening-structure-2026-08-14T01-00-49-104Z",
    keepPadrao: 10,
    env: "PUSH_OPENING_KEEP",
  },
  {
    id: "push-curation",
    dono: "db-push-curation.mjs",
    oQueE: "STAGING do push de curadoria (~95 MB) — TSV do que foi lido, não é backup",
    casa: (n) => /^push-curation-\d{4}-\d{2}-\d{2}T/.test(n),
    exemplo: "push-curation-2026-08-10T17-37-07-121Z",
    keepPadrao: 2,
    env: "PUSH_STAGE_KEEP",
  },
  {
    id: "push-evals",
    dono: "db-push-evals.mjs",
    oQueE: "staging do push de avaliações de IA (~2 MB)",
    casa: (n) => /^push-\d{4}-\d{2}-\d{2}T/.test(n),
    exemplo: "push-2026-08-04T04-19-44-904Z",
    keepPadrao: 3,
    env: "PUSH_EVALS_KEEP",
  },
  {
    id: "new-works",
    dono: "db-push-new-works.mjs",
    oQueE: "cofre auto-contido das obras novas (~1,3 MB) — grava inclusive em --dry-run",
    casa: (n) => /^new-works-\d{4}-\d{2}-\d{2}T/.test(n),
    exemplo: "new-works-2026-08-04T15-56-02-670Z",
    keepPadrao: 5,
    env: "COFRE_KEEP",
  },
  {
    id: "synopsis-lab",
    dono: "synopsis-prompt-lab.ts",
    oQueE: "saídas do laboratório de prompt de sinopse (~44 KB)",
    casa: (n) => /^synopsis-lab-\d{4}-\d{2}-\d{2}T/.test(n),
    exemplo: "synopsis-lab-2026-07-30T05-38-06-927Z",
    keepPadrao: 3,
    env: "SYNOPSIS_LAB_KEEP",
  },
  {
    id: "fingerprints",
    dono: "db-table-fingerprint.mjs",
    oQueE: "snapshots de fingerprint por tabela — diretório FIXO, não versionado",
    casa: (n) => n === "fingerprints",
    exemplo: "fingerprints",
    keepPadrao: null,
    env: null,
  },
]

/** Quantas guardar nesta família, respeitando a env que o script dela sempre aceitou. */
export function keepDe(familia) {
  if (familia.keepPadrao == null) return null
  const bruto = familia.env ? process.env[familia.env] : undefined
  const n = Number(bruto ?? familia.keepPadrao)
  // Um `keep` de 0 apagaria o que acabou de ser gravado; NaN viraria "apague tudo" no slice.
  return Number.isFinite(n) ? Math.max(1, n) : familia.keepPadrao
}

function listar(base) {
  if (!fs.existsSync(base)) return []
  return fs.readdirSync(base)
}

/**
 * Entradas de `.backups` que não pertencem a nenhuma família declarada.
 *
 * 🔴 Esta é a defesa que pega o PRÓXIMO script, e não o que já conhecemos. Sem ela, corrigir o
 * `push-curation` teria sido só o conserto de um caso. Medido em 2026-08-10, ela já acusaria
 * três órfãos de comando ad-hoc que nunca tiveram dono: `2026-07-31-pre-mig169` (**33 MB**, que
 * escapa do regex do backup-db pelo sufixo), `orphan-fix-….json` e
 * `prediction-snapshots-locais-….tsv`.
 */
export function entradasSemDono(base = BASE) {
  return listar(base).filter((nome) => !FAMILIAS.some((f) => f.casa(nome)))
}

/**
 * Poda uma família e denuncia o que não tem dono.
 *
 * ⚠️ Chame ANTES de gravar o diretório novo, não depois. Cada execução deixa staging, e um
 * ensaio interrompido deixa igual — podar só no caminho de sucesso deixa de fora justamente as
 * execuções que mais acontecem enquanto se ajusta o script. (Exceção: `backup-db.mjs` poda no
 * FIM de propósito, porque lá o novo backup precisa ter passado na conferência antes de a gente
 * descartar um antigo que estava bom.)
 */
export function podar(familiaId, { base = BASE, log = console.log } = {}) {
  const familia = FAMILIAS.find((f) => f.id === familiaId)
  if (!familia) throw new Error(`família desconhecida em .backups: "${familiaId}" — declare em FAMILIAS`)

  const keep = keepDe(familia)
  let apagados = []
  if (keep != null) {
    // Stamp ISO é lexicograficamente ordenável, então `sort()` já é ordem cronológica.
    const todos = listar(base).filter((n) => familia.casa(n)).sort().reverse()
    apagados = todos.slice(keep)
    for (const nome of apagados) fs.rmSync(path.join(base, nome), { recursive: true, force: true })
    if (apagados.length) {
      log(`🧹 retenção (${familia.id}): apagados ${apagados.length}, mantidos ${keep}` +
        (familia.env ? ` — ajuste com ${familia.env}=<n>` : ""))
    }
  }

  const orfaos = entradasSemDono(base)
  if (orfaos.length) {
    log(`⚠️  ${orfaos.length} entrada(s) em .backups sem dono — nenhuma retenção as cobre:`)
    for (const o of orfaos.slice(0, 5)) log(`     ${o}`)
    if (orfaos.length > 5) log(`     … e mais ${orfaos.length - 5}`)
    log(`     Declare a família em scripts/lib/backups-retencao.mjs ou apague à mão.`)
  }
  return { apagados, orfaos }
}
