# Opção E — `attribute_bias` com deltas AO VIVO (pré-Fase 3)

> Status: **DESENHO, não implementado.** Fazer ANTES de ligar o pooling multi-user (Fase 3), não
> urgente. Impacto na nota de hoje é abaixo do ruído — ver medição em
> `scripts/measure-stale-assessments.mjs` e a memória `project_attribute_bias_multiuser_fase3`.

## Problema

`recomputeAttributeBias` (`lib/calculations/attribute-bias.ts`) treina o offset com deltas
**congelados**: `ia_value_at_assessment − user_value`. Quando uma obra é reavaliada pela IA sem o
usuário refazer a pós-leitura, aquele snapshot fica preso à IA antiga. Medido em 2026-07-16: **25,5%
das assessments do dono são stale**, espalhadas por **6 versões de prompt (v16–v21)**. A fração só
cresce a cada nova versão de prompt/re-avaliação.

## Mudança

Calcular o delta contra o `suggested_score` **atual** (última `ai_evaluations` `completed` da obra):

```
delta = suggested_score_atual[work, slug] − user_value      // era: ia_value_at_assessment − user_value
```

`ia_value_at_assessment` / `ia_model_at_assessment` / `ia_prompt_version` **permanecem** — viram só
registro de auditoria (contra qual IA o usuário julgou), não a fonte do delta. Staleness deixa de
existir por construção. Bônus: as 9 linhas legadas sem `ia_evaluation_id` também passam a ser
corrigidas (o lookup é por (work, slug), não pelo id gravado).

## ⚠️ Pegadinha central — dois clientes

`ai_evaluations` / `ai_evaluation_scores` são **catálogo, sem RLS**. Hoje `recomputeAttributeBias` é
chamado com o cliente de **sessão** (`userDb`) em `submitPostReadingAttributes:87`. Ler o catálogo com
o cliente de sessão devolve **0 linhas em silêncio** → todo delta pulado → **bias zerado sem erro**.
É exatamente a armadilha de dois-clientes do CLAUDE.md.

→ A leitura dos `suggested_score` atuais **tem que ser pelo cliente admin** (service role).

## Arquivos

| Arquivo | Mudança |
|---|---|
| `lib/calculations/attribute-bias.ts` | `recomputeAttributeBias(userId, userDb, adminDb)` — novo arg admin; delta contra score ao vivo. `computeBiasForSlug` (núcleo puro) **não muda**. |
| `server/actions/post-reading-attributes.ts:87` | passar o admin: `recomputeAttributeBias(userId, userDb, supabase)` (o `supabase` admin já existe na função). |

## Esboço da implementação

```ts
export async function recomputeAttributeBias(userId, userDb, adminDb) {
  // per-user (sessão, RLS)
  const { data: rows } = await userDb
    .from("user_attribute_assessment")
    .select("work_id, attribute_slug, user_value")   // ia_value_at_assessment NÃO é mais a fonte
    .eq("user_id", userId)

  const workIds = [...new Set((rows ?? []).map(r => r.work_id))]

  // CATÁLOGO (admin!) — última avaliação completed por obra, chunked (.in gotcha)
  const currentByWork = await loadCurrentSuggestedScores(adminDb, workIds) // Map<work, Map<slug, number>>

  const deltasBySlug = new Map(CRITERION_SLUGS.map(s => [s, []]))
  let skippedNoCurrent = 0
  for (const r of rows ?? []) {
    const cur = currentByWork.get(r.work_id)?.get(r.attribute_slug)
    if (cur == null) { skippedNoCurrent++; continue }  // sem leitura atual → nada a calibrar
    deltasBySlug.get(r.attribute_slug)?.push(Number(cur) - Number(r.user_value))
  }
  if (skippedNoCurrent) console.warn(`[recomputeAttributeBias] ${skippedNoCurrent} rows sem score atual`)

  // resto idêntico: computeBiasForSlug + upsert em attribute_bias (userDb, per-user)
}
```

`loadCurrentSuggestedScores`: replica a lógica do harness — `ai_evaluations` `status=completed`,
`.in('work_id', chunk)` (chunks de ~150, embed `ai_evaluation_scores`), reduz ao mais recente por
`created_at`, monta `Map<work, Map<slug, suggested_score>>`.

## Decisões

- **Row sem score atual** (atributo omitido na última avaliação, ou — raro — obra sem completed):
  **pula** aquela amostra. Não cai pro congelado (misturaria vintages de novo).
- **`user_value` continua válido**: é a leitura de intensidade do LEITOR, independe da IA ter rodado
  de novo. Só a âncora de comparação (o valor da IA) passa a acompanhar o presente.
- **Custo**: +1 leitura de catálogo (~137 obras, chunked) por save de pós-leitura. Aceitável (o caminho
  já faz recompute + `markRecalcPending`). Otimizar só se doer.
- **Rejeitada — opção C** (backfill que reescreve `ia_value_at_assessment` para o valor atual): muta
  linhas e só corrige dali pra frente; E não muta nada e é sempre correto on-compute.
- **Rejeitada — view/RPC SQL**: migrations aqui são aplicadas à mão; TS-side é menos atrito.

## Validação (harness pronto)

1. **Antes**: `node scripts/measure-stale-assessments.mjs` → anotar coluna `biasApp(vivo)`.
2. **Depois**: disparar um recompute (salvar qualquer pós-leitura, ou CLI que chame a função) e ler a
   tabela `attribute_bias` → tem que casar com `biasApp(vivo)` (±0,01).
3. **Guard anti-regressão**: nenhum atributo pode zerar de repente (sinal de que caiu no bug do
   cliente de sessão lendo catálogo → 0 linhas).
4. Re-rodar o harness: `stale` continua 25%+ (esperado — é a auditoria), mas agora `biasApp(cong)` ==
   `biasApp(vivo)` na prática, porque o bias gravado passou a ser o "vivo".

## Checklist do PR

- [ ] `suggested_score` atual lido via cliente **admin** (não sessão) — senão zera em silêncio
- [ ] `.in(workIds)` em chunks (gotcha do CLAUDE.md)
- [ ] rows sem score atual → puladas + `console.warn` com a contagem
- [ ] `ia_value_at_assessment` mantido no schema (auditoria) — não dropar
- [ ] before/after batendo com a coluna `vivo` do harness
- [ ] PR **antes** do pooling hierárquico da Fase 3
