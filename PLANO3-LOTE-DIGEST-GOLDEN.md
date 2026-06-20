STATUS: NÃO EXECUTADO — AGUARDANDO AUTORIZAÇÃO DE CUSTO

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
