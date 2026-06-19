# Manifesto — Snapshot-base + Pacote cego (Plano 3 Fase B2.1C)

> Manifesto **versionado** (sem conteúdo integral: sem sinopse/tags/reviews/labels).
> Gerado por [scripts/synopsis-interest-snapshot.ts](scripts/synopsis-interest-snapshot.ts)
> (read-only no banco). Os artefatos completos vivem em `.local-experiments/` (gitignored):
> `golden-snapshot-base.json`, `golden-labeling.html`, `golden-labels-template.csv`, `manifest.json`.
> Reprodutível: a mesma base do banco ⇒ o **mesmo** `snapshotBaseSignature` (verificado: 2 runs idênticas).

## Versões congeladas
```
experiment_version    = digest-exp-1
golden_version        = pilot-1
snapshot_version      = base-1
taste_profile_version = v7   (signature 23eb13f0…)
baseline_prompt        = v2          (b1)
enriched_prompt        = v2+digest   (e1)
schema_version        = v1
model                 = claude-sonnet-4-6
digest_version        = digest-v1
captured_at           = 2026-06-19T21:54:51Z   (NÃO entra na snapshotBaseSignature)
```

## Agregados
| Métrica | Valor |
|---|---|
| obras únicas | **80** |
| slots | **90** (80 + 10 repetições) |
| split | development **50** · holdout **30** |
| strata | ♥ 20 · ♥♥ 20 · ♥♥♥ 20 · ♥♥♥♥ 20 |
| tag context | `tags_present` **79** · `missing_recoverable_frozen_empty` **1** (S078) |
| review state | `frozen_current` **51** · `no_reviews` **29** |

## Assinaturas e checksums
```
snapshotBaseSignature      = 634571c2faa0292394b38f12235beff8ba67ed51a98bf8e04b57056234fa681d
reviewCorpusSignature      = 8776419ed4006810b832613e5df606d52077838ce00c3e77190a461880b5c45e
labelingPackageSignature   = 73eb0f5dbdf80308d891a885aac35e85e0557eabb1541e113758aca8c5f00785

golden-snapshot-base.json  sha256 = 8adb3461096ef42efde6d061aa1d67259bc0488e5ca40148065d4ff19d3dd31e   (248.708 bytes)
golden-labeling.html       sha256 = dac08b1708bd6022f85dee3e070b54444b1b69d10931896949a338e28eaba0e4   (78.076 bytes)
golden-labels-template.csv sha256 = 078f5170357797e30250fb9542e33dfebfe6139a1e2083e39695caa28a5ffeee   (555 bytes)
```
A **imutabilidade** é garantida pelo `snapshotBaseSignature` (order-independent, sem `captured_at`): qualquer mudança em título/sinopse/tags/perfil/corpus-de-reviews de qualquer obra altera o hash.

## Unidade de rotulagem × unidade estatística
```
unidade de rotulagem        = slot (90)
unidade estatística principal = work_id único (80)
slots repetidos (10)        = confiabilidade intra-avaliadora (NÃO contam como observações independentes)
split                       = por work_id (todos os slots de uma obra no MESMO split)
```

## Repetições cegas (10) — mesma obra, conteúdo idêntico, sem marca
| repeat | original | work (prefixo) | split / stratum |
|---|---|---|---|
| R001 | S071 | e7156496 | development / ♥♥♥♥ |
| R002 | S023 | 20714b59 | development / ♥♥ |
| R003 | S080 | 9713eca5 | holdout / ♥♥♥♥ |
| R004 | S036 | e9c34238 | holdout / ♥♥ |
| R005 | S044 | 65a903e1 | development / ♥♥♥ |
| R006 | S019 | d228b0f1 | holdout / ♥ |
| R007 | S073 | 101bc8ed | holdout / ♥♥♥♥ |
| R008 | S030 | 4fb5ad87 | development / ♥♥ |
| R009 | S003 | 54520edc | development / ♥ |
| R010 | S052 | 40d73e3e | development / ♥♥♥ |

Cada repetição mostra a **sinopse idêntica** da obra original (mesmo `work_id`), em ordem embaralhada, **sem indicação de repetição** no HTML.

## S078 (proveniência distinta)
```
work_id          = 1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f   (slot S078, holdout, ♥♥♥♥)
tag_context_type = missing_recoverable_frozen_empty        (NÃO no_tags_legitimate)
tags             = []                                       (tagsSignature 3097577205…)
review_state     = frozen_current (15 reviews úteis)
```
`tags=[]` congelado de propósito (recuperável das fontes externas, não buscado). A `tagsSignature` é **distinta** de `no_tags_legitimate` e de qualquer lista de tags; `loading_error` (null) nunca produz assinatura.

## Regra de invalidação do digest futuro (snapshot-enriched)
Antes de gerar qualquer digest (etapa paga separada, `enriched-1`), o planner DEVE verificar, por obra:
```
reviewCorpusSignature(reviews atuais)  ==  reviewCorpusSignature congelada no base-1
```
Se divergir ⇒ **não gerar digest**, marcar `plan_changed`, exigir nova `snapshot_version`. O `enriched-1` deriva exclusivamente do `base-1` (título/sinopse/tags/perfil/reviews congelados), acrescenta digest fresh ou estado explícito (`digest_failed` ⇒ **não** regenerar summary silenciosamente), e recomputa apenas `review_context_signature` + `enriched_input_signature` (nunca o input base de b1).

## 80 work_ids (auditoria — NÃO mostrados ao avaliador)
```
038a4e0b 09bf3743 101bc8ed 16080ccb 1a8ec6b3 1cf09135 1e4dc6ba 1ed45f04
20024e21 20714b59 2293ff4f 22a12e5b 25007e9b 2bb30182 344aabeb 3708a5b1
38c1c3d1 3c18ad94 3fb1bf39 40269ebf 40d73e3e 42dc8afb 45a02fdc 4825fdc3
49fcd5fa 4e4b63d8 4fb5ad87 51bd3a7c 535934a9 54520edc 58533140 60b9bde7
652bfc21 65a903e1 66d34ab5 673929ba 6af9df4e 6bce625f 7d8aac45 8039c21c
84314635 87265266 889a02ce 8947a67f 897b14aa 89ccfdc3 8ef70e2f 90252bcf
931e2fb4 9713eca5 988a5c83 9a5613e7 9b539d1f 9c331c77 9ff68660 a6ff6a17
ac5aa12d ae687e42 b459e823 b76764cb b96d8f18 bdf55765 c00530b3 c3dacd89
ca254b3a cd3e3678 ced72849 d228b0f1 e01de45f e15d19df e7156496 e84c3bac
e9c34238 ec191e22 efc9c19c f1dc73bd f4064dde f70d1b64 f81394f3 fe0d787c
```
(prefixos de 8 chars; UUIDs completos no `golden-snapshot-base.json`/`manifest.json` locais.)

## Regeneração / verificação
```
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/synopsis-interest-snapshot.ts
```
Confirma os hashes acima. Read-only no banco; escreve só em `.local-experiments/` (gitignored).
