# Manifesto — Snapshot ENRIQUECIDO (`enriched-1`) + Pacote contextual (Plano 3 Fase B2.2C)

> **⚠️ pilot-1 SUPERSEDED (2026-06-23).** Este snapshot pertence ao golden pilot-1, substituído pelo golden **prospectivo pilot-2** (leakage retrospectivo). A infra foi reaproveitada; os **resultados finais + o contrato ratificado (b1, sem digest)** estão em [PLANO-MESTRE §24i/§24j](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md). Mantido como registro histórico.

> Manifesto **versionado** (sem sinopses/digests integrais). Gerado por
> [scripts/synopsis-interest-enriched.ts](scripts/synopsis-interest-enriched.ts) (read-only).
> Deriva ESTRITAMENTE de [base-1](PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md) + os 51 digests
> (sanitizados). Artefatos completos em `.local-experiments/plan3/digest-exp-1/enriched-1/`
> (gitignored): `golden-snapshot-enriched.json`, `golden-contextual-labeling.html`,
> `golden-contextual-labels-template.csv`, `golden-contextual-labeling-manifest.json`.
> Reprodutível: mesma base/digests ⇒ mesmo `enrichedSnapshotSignature` (verificado: runs idênticas).

## Versões congeladas
```
experiment_version        = digest-exp-1
golden_version            = pilot-1
base_snapshot_version     = base-1            (preservado, inalterado)
enriched_snapshot_version = enriched-1
contextual_package_version = contextual-1
target_construct          = contextual-work-interest-v1
taste_profile_version     = v7
digest_version            = digest-v1
schema_version            = v1
captured_at               = 2026-06-20T02:33:04Z   (NÃO entra na assinatura)
```

## Assinaturas
```
baseSnapshotSignature         = 634571c2faa0292394b38f12235beff8ba67ed51a98bf8e04b57056234fa681d   (de base-1)
reviewCorpusSignature         = 8776419ed4006810b832613e5df606d52077838ce00c3e77190a461880b5c45e   (de base-1)
enrichedSnapshotSignature     = 8b61084d71e8b01e420ba4db9b9263a02dda83a5c5bd51fa0c026bf08429c2bf
sanitizedDigestCorpusSignature = 7958c23603cd196c6bae5936ee9e3e362645c0129d0c5222100655f997686643
contextualPackageSignature    = 9e4d1b9fad1bd97936f0ae23acf55621dbd6d31ef2b5dc2479893c309b927a42
```

## Artefatos (SHA-256 / bytes)
```
golden-snapshot-enriched.json          951547884dc5ea3b2102bdebf356606799dd3128fa75827bc44215ef4fb85133   276.785
golden-contextual-labeling.html        a9ca5e76b432c3423c0c2c418f9824349ca8b52d29c733df0d8fbefb68b77c60   296.861
golden-contextual-labels-template.csv  078f5170357797e30250fb9542e33dfebfe6139a1e2083e39695caa28a5ffeee   555
```

## Estados
| Métrica | Valor |
|---|---|
| obras únicas | **80** |
| slots | **90** (50 dev / 30 holdout; strata 20×4 — ver base-1) |
| `digest_available` | **51** |
| `no_reviews_available` | **29** |
| tag context | `tags_present` **79** · `missing_recoverable_frozen_empty` **1** (S078) |
| `summary_fallback` | **0** (não existe nesta versão) |
| `digest_failed` / `corpus_changed` | **0 / 0** |

Os **80 work_ids** estão no [manifesto base-1](PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md) (inalterados). O enriched-1 carrega `baseInputSignature` por obra (amarra à base congelada).

## Política de sanitização (`sanitizeDigestForLabeling` + `DIGEST_FIELD_POLICY`)
- **Removido do digest exibido:** notas (`n/10`, `n de 10`), estrelas (★/⭐), rankings, recomendação direta ("você vai gostar", `recomend*` incl. **acentuados**, "vale a pena", "must-read"), URLs. (IDs/prompt/model/popularidade/nº de reviews/fontes **nunca** entram no schema do digest.)
- **Preservado:** consenso, divergências, traços recorrentes (+ polaridade), execução, avisos de conteúdo.
- **Determinístico:** mesmo digest bruto ⇒ mesmo sanitizado ⇒ mesma assinatura. O **digest BRUTO persistido NÃO é alterado** (sanitização só na exibição/snapshot enriquecido).

### Contagem de remoções (scan pós-sanitização, 51 digests)
```
digests brutos com nota-token     : 1  → removido (0 restante)
digests brutos com recomendação   : 1  → removido (0 restante; fix B2.2C do regex acentuado)
sanitizados com nota/recomendação/URL : 0 / 0 / 0
sanitizados com contexto vazio    : 0
```

## Subgrupo `no_reviews_available` (29 — análise separada futura)
```
1e4dc6ba 1ed45f04 20024e21 20714b59 25007e9b 344aabeb 3c18ad94 4825fdc3
49fcd5fa 535934a9 54520edc 60b9bde7 673929ba 84314635 87265266 8947a67f
897b14aa 8ef70e2f 90252bcf 9a5613e7 9b539d1f ac5aa12d b96d8f18 bdf55765
ca254b3a e01de45f e15d19df ec191e22 efc9c19c
```
(prefixos 8 chars; UUIDs completos no snapshot local.) Mostram a mensagem neutra de `no_reviews_available`; **não** escondidos, **não** marcados como grupo experimental.

## Pacote contextual cego
- **HTML offline** (a9ca5e76…): por slot mostra **SINOPSE + ELEMENTOS DA OBRA (tags contextuais) + CONTEXTO DE LEITORES (digest sanitizado ou `no_reviews_available`)** + rúbrica contextual. **NÃO** mostra: título, work_id, capa, fonte, nº de reviews, candidato, previsão, scores, alignment, ranking, split, stratum, versões, assinaturas. Validação estrutural: **0 leakage** (0 script/URL/work_id/token técnico; 90 cards).
- **Tags:** `selectContextualTags` (exclui `format`/`other`, dedupe determinístico, ordem canônica, máx 30; origem = base-1, sem busca live). Catálogo nome→grupo = `TAG_GROUPS_CATALOG` estático.
- **S078:** mensagem "Não há elementos categorizados disponíveis no snapshot desta obra." (não `no_tags_legitimate`).
- **Repetições:** 10 slots repetidos com conteúdo contextual idêntico, mesma split, sem marca; só p/ consistência intra-avaliadora. **Unidade estatística = work_id único** (não 90 slots).
- **Rúbrica:** contextual (mede a OBRA: sinopse + elementos + contexto) — [RUBRIC-CONTEXTUAL.md](lib/synopsis-interest/RUBRIC-CONTEXTUAL.md). A synopsis-only [RUBRIC.md](lib/synopsis-interest/RUBRIC.md) está SUPERSEDED.

## Pacote synopsis-only (base-1) — SUPERSEDED
```
SUPERSEDED — NÃO UTILIZAR PARA ROTULAGEM
.local-experiments/plan3/digest-exp-1/base-1/golden-labeling.html
```
Preservado (não apagado); aviso local em `.../base-1/SUPERSEDED-NAO-USAR.txt`. A rotulagem **ATIVA** usa **`enriched-1/golden-contextual-labeling.html`**.

## Regeneração / verificação
```
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/synopsis-interest-enriched.ts
```
Read-only no banco (bloqueia se corpus/digest divergir); escreve só em `.local-experiments/` (gitignored). Confirma os hashes acima.
