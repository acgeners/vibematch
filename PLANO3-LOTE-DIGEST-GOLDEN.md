STATUS: EXECUTADO ✅ — 51/51 digests gerados (Fase B2.2B, 2026-06-20); custo real US$ 0,8578 ≤ teto US$ 3,50; status `completed`, exit 0. Ver "RESULTADO DA EXECUÇÃO" no fim.

# Lote de digests do golden contextual (Plano 3 Fase B2.2A)

> Dry-run **read-only** — 2026-06-20. Prepara a geração dos digests do golden (base-1)
> sem nenhuma chamada paga. Planner/runner agregado seguro em
> [lib/synopsis-interest/golden-digest.ts](lib/synopsis-interest/golden-digest.ts);
> CLI [scripts/golden-digest-batch.ts](scripts/golden-digest-batch.ts) (`npm run digest:golden`).
> Banco só `SELECT`. Zero LLM/digest/job/escrita.

## Estado do snapshot (compatível ✅)
```
experiment_version    = digest-exp-1
golden_version        = pilot-1
snapshot_version      = base-1
snapshotBaseSignature = 634571c2faa0292394b38f12235beff8ba67ed51a98bf8e04b57056234fa681d
reviewCorpusSignature = 8776419ed4006810b832613e5df606d52077838ce00c3e77190a461880b5c45e   (global, MATCH com o banco atual)
```
`base-1` **permanece utilizável** — verificado read-only. Arquivo local: `.local-experiments/plan3/digest-exp-1/base-1/golden-snapshot-base.json` (gitignored; `snapshotBaseSignature` é o invariante congelado — o SHA do arquivo varia por `capturedAt`).

## Mudanças concorrentes verificadas
O catálogo cresceu entre sessões (atividade do app, **não** desta etapa):
```
works ativas: 734 → 737   ·   digests globais: 14 → 17   ·   jobs globais: 114 → 123
```
**Nenhuma** atingiu as 80 obras do golden:
- **corpus_changed = 0/80** (todas as 51 frozen_current + 29 no_reviews têm `reviewCorpusSignature` idêntico ao base-1; o global bate).
- **digests reutilizáveis do golden = 0** (os 3 digests novos são de obras **fora** do golden).
- **regra bloqueante NÃO disparada** ⇒ plano executável; **não** exige `base-2`.

## Escopo exato (51 a gerar)
| Classe | Qtde |
|---|--:|
| corpus_unchanged_digest_missing (**a gerar**) | **51** |
| corpus_unchanged_digest_fresh_reusable | 0 |
| corpus_unchanged_digest_stale | 0 |
| no_reviews_available (**excluído**) | 29 |
| corpus_changed (bloqueante) | 0 |
| total golden | 80 |

**SHA-256 da lista canônica dos 51 work_ids (ordenada):** `7b264c55a6f6fc5b6e440442b805fbcbcd3a4ee6b959501fe050bbaf98aaf8f3`

(Os 51 IDs incluem `1a8ec6b3…` = S078, que tem reviews mas `tags=[]` — gera digest normalmente.)

## Plano
```
planSignature   = e44e5996b11187d3dcfeedba83e70b7e4f51bca4760581375d9f3a691135f3f2
model           = claude-sonnet-4-6      digest_version = digest-v1      schema = v1
pricing_version = static@2026-05-23       cost_policy = safety-1.5 + micro-0.02
```

| Operação | Quantidade | Likely | Upper |
|---|--:|--:|--:|
| ensure_review_digest | 51 | **$2.2719** | **$3.4078** |
| **Total** | **51** | **$2.2719** | **$3.4078** |

```
itemsEligible = 51   itemsReusable = 0   itemsMissing = 51   itemsStale = 0   itemsBlocked = 0
likelyUsd = 2.2719   upperBoundUsd = 3.4078
teto MÍNIMO técnico (ceilUsdToCents(upper)) = $3.41
teto HUMANO recomendado = $3.50   (≥ upper; margem mínima; nunca arredonda p/ baixo)
```
> ⚠️ Os valores antigos (likely ≈ $1.0 / upper ≈ $5.9) eram **projeções**. Os reais do plano atual são **$2.27 / $3.41** (estimateStep de produção: Sonnet base 1500/2000 + 350/review × min(úteis,40), × 1.5).

## Comando futuro (NÃO executado)
```bash
npm run digest:golden -- \
  --execute \
  --golden-version=pilot-1 \
  --snapshot-version=base-1 \
  --plan-signature=e44e5996b11187d3dcfeedba83e70b7e4f51bca4760581375d9f3a691135f3f2 \
  --max-cost-usd=3.50 \
  --concurrency=2
```
- **SEM** `--retry-failed` na 1ª execução.
- Exige `--execute` + `--plan-signature` + `--max-cost-usd` + `--snapshot-version=base-1` + `--golden-version=pilot-1`.
- Reusa `ensureReviewDigest` (job durável + dedup + cost gate). **NÃO** usa o lote legado de `settings`.

## Critérios de interrupção (execução futura)
- **corpus_changed** (qualquer obra do golden ganhou/perdeu review) ⇒ `plan_changed` antes da 1ª chamada ⇒ aborta, exige `base-2`.
- **assinatura divergente** (`--plan-signature` ≠ recomputada) ⇒ aborta (zero custo).
- **teto < upper** ⇒ aborta.
- **soft-cap:** `custo real acumulado + upper(próxima) > maxCostUsd` ⇒ `stoppedByCost` (parcial).
- **re-check por obra:** snapshot/corpus divergente ⇒ `plan_changed`, não inicia a obra.
- **SIGINT/SIGTERM** ⇒ não inicia novos; conclui em-voo; estado parcial.
- **falha de digest** ⇒ job `failed` persistido (erro sanitizado); **sem** retry automático; **sem** fallback de summary; sucessos preservados.
- **status:** `completed` só se 51/51 succeeded/reused; senão `completed_with_failures`/`partial` (exit ≠ 0).

## Checklist pós-execução (futuro)
- 51/51 digests `digest-v1` presentes nas obras elegíveis (ou estado de falha explícito).
- nenhuma obra fora das 51 alterada; 29 `no_reviews_available` intactas; nenhuma review/summary criada.
- `reviewCorpusSignature` global ainda bate (digest não altera reviews).
- jobs: +N `generate_review_digest/succeeded`; failures persistidas; sem queued/running órfão; custo real ≤ teto.
- **NÃO** gerar automaticamente: snapshot-enriched, pacote contextual, labels, candidatos. Isso é etapa seguinte (verificar 51/51 → sanitizar → materializar `enriched-1` → pacote contextual → validar leakage → liberar rotulagem). Se houver falha persistente em algum digest, **parar para decisão** antes do pacote contextual.

---
### Banco (esta etapa — somente SELECT)
```
zero reviews · zero summaries · zero digests criados/alterados · zero predictions · zero candidatos
zero labels · zero jobs criados · zero chamadas pagas · zero migrations
golden corpus inalterado (corpus_changed=0); base-1 íntegro (634571c2…)
```

---

# RESULTADO DA EXECUÇÃO — Fase B2.2B (2026-06-20)

> Execução paga **autorizada e concluída**. Teto US$ 3,50. Comando único com `--execute`,
> assinatura aprovada. Banco read-only na verificação posterior.

## Pré-execução (confirmado, 🟩)
- Branch `feat/data-orchestration`; working tree limpo; HEAD `ce6cd35`.
- **Dry-run final idêntico ao aprovado:** `planSignature=e44e5996…`, 51 elegíveis / 0 reutilizáveis / 29 no_reviews / 0 corpus_changed, upper $3.4078 ≤ $3.50, versões model=sonnet-4-6 / digest-v1 / schema v1 / pricing static@2026-05-23.
- **Assinaturas:** `snapshotBaseSignature=634571c2…` · `reviewCorpusSignature=8776419e…` (bate com o banco).
- **51 IDs:** SHA-256 `7b264c55…` (idêntico ao aprovado). **labels 0/90.** **0 jobs queued/running** para os 51. **0 corpus drift.** **0 já com digest-v1.**
- **Backup de segurança (gitignored):** `.local-experiments/plan3/digest-exp-1/base-1/backups/before-2026-06-20-2026-06-20T01-46-36-834Z.json` · **25.479 bytes** · sha256 `b0141e0dbfff225ab83f73bb997d9ab4a1159e7e81eea19ad2f0a4924903d271` · 51 obras (corpus frozen + digest atual + jobs).

## Comando executado
```bash
npm run digest:golden -- --execute --golden-version=pilot-1 --snapshot-version=base-1 \
  --plan-signature=e44e5996b11187d3dcfeedba83e70b7e4f51bca4760581375d9f3a691135f3f2 \
  --max-cost-usd=3.50 --concurrency=2
```

## Resultado (🟩 report do runner)
| | valor |
|---|---|
| status | **completed** (exit 0) |
| planned / started / **succeeded** | 51 / 51 / **51** |
| failed / processing / reused | 0 / 0 / 0 |
| changedDuringRun / stoppedByCost / stoppedByCancel / stoppedByPlanChange | 0 / false / false / false |
| duração | ~12 min (sequencial) |

## Custos (🟩 — cruzado via `ai_api_calls`)
| Operação | Quantidade | Custo real |
|---|--:|--:|
| ensure_review_digest (review_digest) | 51 | **$0.8578** |
| **Total** | **51** | **$0.8578** |

- avg **$0.0168**/digest · min **$0.0082** · max **$0.0385**.
- Comparação: real **$0.8578** ≪ likely $2.2719 ≪ upper $3.4078 ≤ teto $3.50. **Nenhuma outra operação paga** na janela (só `review_digest`).

## Banco — escritas realizadas
- **51 obras**: `review_digest` (jsonb) + `review_digest_version=digest-v1` + `review_digest_n` + `review_digest_at` (somente as 51 elegíveis).
- **+51 jobs** `generate_review_digest/succeeded` (attempts=1).
- **Nenhuma** escrita em reviews, summary, predictions, candidatos, labels, taste_profile, calculated_scores. **Nenhuma migration.**

## Integridade (🟩 read-only)
- **Somente os 51 IDs aprovados** processados (jobs na janela: 51, todos no escopo; `jobsOutsideGolden=0`).
- **29 `no_reviews_available` excluídas** — `noReviewsWithDigest=0`.
- **0 summary jobs** na janela; reviews inalteradas; `corpusUnchanged=51/51` (digest não toca reviews).
- **0 candidatos / 0 predictions / 0 labels** — `predictions=1026`, `taste_profile=7`, `golden_labeled=0` (inalterados).
- attempts=1 em todos (sem retry).

## Validação estrutural (todas as 51)
`present 51 · parseable 51 · version digest-v1 51 · campos obrigatórios (consensus/divergence/execution/salient_traits/content_warnings) 51 · não-vazio 51 · corpus inalterado 51`. Leakage no digest BRUTO: **recomendação 0/51** · **nota/estrela 1/51** (uma obra cita um padrão tipo `n/10`; **será removido pela sanitização** `RATING_RE` de `sanitizeDigestForLabeling` antes da rotulagem — não é bloqueante).

## Amostra (10 digests — só metadados)
Cobertura: reviews 2–36, fontes 1–3, strata variados (dev/holdout). Todos com **5–8 traços salientes**, polaridade mista (positive/negative/mixed), `consensus`/`divergence`/`execution` não-vazios (150–450 chars), `content_warnings` 0–4, `digest_n` = nº de reviews úteis. Conteúdo coerente com o schema e **utilizável pela futura sanitização**. (Conteúdo integral não exibido.)

## Divergências plano × execução
- **Concorrência:** o comando passou `--concurrency=2`, mas o runner roda **sequencial** (1 chamada por vez) — o parâmetro é aceito e ignorado. Efeito: **mais seguro** (sem corrida), apenas **mais lento** (~12 min). Sem impacto no resultado/custo/escopo.
- **Custo real** muito abaixo da estimativa do contrato (estimateStep é conservador); nenhuma consequência.
- Tudo o mais idêntico ao plano: 51/51, 0 falhas, escopo rígido.

## GO / NO-GO para `enriched-1`
🟢 **GO** — 51/51 digests fresh, válidos, `digest-v1`, escopo íntegro, corpus inalterado, custo trivial, 0 falhas. Próxima fase (separada, não autorizada aqui): verificar 51/51 → **sanitizar** (remove o 1 rating-token) → materializar `enriched-1` → gerar pacote contextual cego → validar leakage → liberar rotulagem.
