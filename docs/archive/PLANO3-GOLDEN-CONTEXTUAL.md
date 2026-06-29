# Plano 3 — Golden CONTEXTUAL (Fase B2.1D)

> **⚠️ pilot-1 SUPERSEDED (2026-06-23).** O golden pilot-1 deste documento foi substituído pelo golden **prospectivo pilot-2** (motivo: leakage retrospectivo — obras já lidas). O constructo contextual e a infra foram reaproveitados; os **resultados finais + o contrato ratificado (b1, sem digest)** estão em [PLANO-MESTRE §24i/§24j](PLANO-MESTRE-TRANSICAO-AUDITORIA-PLANO3.md). Mantido como registro histórico.

> Correção do constructo-alvo: de "apelo da sinopse" para **Potencial de Interesse na
> Obra (Contextual Work Interest)**. Sessão read-only (banco só `SELECT`); zero LLM/
> digest/previsão/chamada paga. Deriva de [PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md](PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md)
> e preserva o snapshot-base [base-1](PLANO3-GOLDEN-SNAPSHOT-BASE-MANIFEST.md).

## 1. Constructo único (alvo humano)

**Contextual Work Interest — Potencial de Interesse na Obra.**
> Grau de interesse pessoal na obra considerando a **sinopse**, os **elementos descritos
> por tags** e o **contexto agregado disponível nas reviews**.

Representa uma **decisão real de leitura**, não a atratividade isolada do texto. Uma sinopse atraente pode esconder tags/dinâmicas/consenso de leitores que o usuário rejeita — por isso o rótulo é **contextual**, não "apelo da sinopse".

**Não existem dois goldens.** Há **um** golden contextual. Não se mantém um golden de "apelo da sinopse" como objetivo de produto.

## 2. Pacote synopsis-only — SUPERSEDED

```
SUPERSEDED — NÃO UTILIZAR PARA ROTULAGEM
.local-experiments/plan3/digest-exp-1/base-1/golden-labeling.html
```
Motivo: exibe **apenas a sinopse** → não corresponde ao constructo contextual. Os artefatos locais **não são apagados** (preservados como histórico técnico). O **snapshot-base `base-1` continua válido** e é a base técnica do pacote contextual (mesmas 80 obras / 90 slots / split / assinaturas).

## 3. Conteúdo do futuro pacote CONTEXTUAL (não gerado aqui)

Por slot, de forma neutra e padronizada:
```
SINOPSE
  canonical synopsis congelada (base-1)

ELEMENTOS DA OBRA
  tags selecionadas por política determinística (§4), neutras

CONTEXTO DE LEITORES
  digest sanitizado (§5)  |  fallback explícito (§6)
```
**NÃO mostrar:** previsão, candidate id, taste profile, score, alignment, decision score, ranking, nota externa, popularidade, nível de interesse previsto, resultado de outro modelo. O perfil de gosto é usado pelos **candidatos**, nunca exibido como sugestão de resposta.

## 4. Política de tags (🟦 [contextual-package.ts](lib/synopsis-interest/contextual-package.ts) `selectContextualTags`)

Determinística, testada:
- **Excluir** grupos administrativos/estruturais: `format` (Long Strip/Full Color…) e `other` (catch-all/ruído). Demais grupos mantidos (themes, romance, tone_mood, female_lead, relationship_dynamics, conflict, content_indicator, …).
- **Dedupe semântico:** mesma chave normalizada (lowercase + alfanumérico) ⇒ 1 tag; representativo **determinístico** (menor por grupo→nome, independe da ordem).
- **Ordenação canônica:** grupo → nome.
- **Limite:** `MAX_CONTEXTUAL_TAGS = 30`.
- **Não inventa nem busca** tags novas.

**S078** (`missing_recoverable_frozen_empty`, `tags=[]`): a política retorna `[]`; o display mostra mensagem **neutra**, sem fingir ausência legítima:
> "Não há elementos categorizados disponíveis no snapshot desta obra."

## 5. Digest mostrado (🟦 `sanitizeDigestForLabeling` + `DIGEST_FIELD_POLICY`)

Schema `review_digest`: `consensus`, `divergence`, `salient_traits[{trait,polarity,axis}]`, `content_warnings[]`, `execution`. Classificação dos campos:

| Campo | Política |
|---|---|
| `consensus` / `divergence` / `execution` | **permitido com sanitização** |
| `salient_traits.trait` | **permitido com sanitização** |
| `salient_traits.polarity` / `.axis` | **permitido** |
| `content_warnings` | **permitido** |
| notas/estrelas/ranking | **proibido** (removidos do texto) |
| linguagem de recomendação ("você vai gostar"/"recomendo"/"must-read") | **proibido** (removida) |
| nomes de personagens / eventos / spoilers | minimizados (digest é descritivo por construção; sem campo próprio) |

O contexto exibido deve: descrever traços recorrentes (positivos **e** negativos); **não** recomendar a obra; **não** prever o interesse da avaliadora; remover notas/estrelas/rankings; minimizar spoilers; usar formato uniforme entre obras.

## 6. Fallback de contexto de review (futuro, congelado)
```
digest fresh disponível   → usar digest
digest falhou             → estado digest_failed EXPLÍCITO (sem fallback silencioso)
sem reviews úteis         → no_reviews_available
```
**Não** usar automaticamente os 9 summaries stale. **Não** regenerar summary silenciosamente se o digest falhar. Adotar summary como fallback exigiria **decisão explícita + nova versão de protocolo + nova assinatura de candidato**.

## 7. As 29 obras sem reviews — `no_reviews_available`

Não é equivalência de qualidade com obras que têm digest. Estado explícito **`no_reviews_available`**; no pacote contextual:
> "CONTEXTO DE LEITORES — Nenhum contexto agregado de leitores está disponível para esta obra no snapshot atual."

Registrado: (a) menor cobertura de informação; (b) o candidato enriquecido terá **menos contexto**; (c) o **custo de previsão pode ser semelhante** apesar de menos evidências; (d) resultados desse grupo **analisados separadamente**; (e) a ausência **não é escondida** na métrica agregada.

**Análises obrigatórias:** todas as 80 · subconjunto **com digest** · subconjunto **sem reviews** · S078/missing-tag-context.

## 8. Reviews adicionadas após o snapshot → nova versão

`base-1` é **imutável**. Se uma review for adicionada a uma das 29 obras depois de `base-1`:
```
nova snapshot version (base-2)  ·  novo reviewCorpusSignature  ·  novo plano de digest  ·  novo pacote contextual
```
**Não** atualizar silenciosamente o experimento congelado. A aba "Sem reviews" (Parte B) alerta quando a obra pertence ao golden:
> "Esta obra pertence ao golden pilot-1. Adicionar reviews exigirá uma nova versão do snapshot experimental."

## 9. Candidatos (🟦 `CANDIDATES`, todos vs o MESMO rótulo contextual)

| ID | Entradas | Tipo |
|---|---|---|
| **S0** | sinopse | LLM |
| **S1** | perfil + sinopse | LLM |
| **D1** | perfil + tags | determinístico |
| **D2** | perfil + sinopse + tags | determinístico |
| **b1** | perfil + título + sinopse + tags | LLM |
| **e1** | b1 + digest/summary/no_reviews | LLM |

`b1`/`e1` preservam **exatamente** a assinatura anterior **de cada um** (vs. antes de estender os candidatos) ⇒ **snapshot base-1 inalterado** (`snapshotBaseSignature=634571c2…`). **Esclarecimento (B2.2A):** `b1` e `e1` derivam da **mesma base de inputs de trabalho** (mesmo título/sinopse/tags/perfil), mas as **assinaturas FINAIS são distintas** — `candidate id`, `prompt version`, `review context`, `review context signature` e a assinatura final separam `b1` de `e1`. "Assinatura idêntica" referia-se ao fato de cada um manter seu próprio hash anterior, **não** a `b1 == e1`. Candidatos com menos dados tentam aproximar o julgamento completo.

**Perguntas experimentais:** (1) sinopse sozinha basta? (2) perfil melhora? (3) tags somam sinal? (4) título soma ou só reconhecimento? (5) digest melhora vs baseline? (6) o ganho do digest é só no subconjunto com reviews? (7) compensa custo/complexidade? (8) determinísticos (D1/D2) são competitivos?

## 10. Métricas

- **Principal:** **MAE ordinal pareada por obra única no holdout**.
- Repetições (10) só para **confiabilidade intra-avaliadora** — **nunca** como observações independentes.
- **Unidade estatística:** **80 work_ids únicos** (não 90 slots).
- **Comparações obrigatórias:** `e1 vs b1` (mesmas obras) · `b1 vs D2` · `S1 vs S0` · `D1/D2 vs candidatos LLM`.
- **Subgrupos separados:** com digest · sem reviews · S078/missing tag context.

## 11. Lote de digests do golden — dry-run CONCLUÍDO (B2.2A; NÃO executado pago)

Ver **[PLANO3-LOTE-DIGEST-GOLDEN.md](PLANO3-LOTE-DIGEST-GOLDEN.md)** (`STATUS: NÃO EXECUTADO — AGUARDANDO AUTORIZAÇÃO DE CUSTO`). Planner/runner agregado seguro em [golden-digest.ts](lib/synopsis-interest/golden-digest.ts) + CLI `npm run digest:golden`.

Dry-run (B2.2A): compatível (`corpus_changed=0`); 51 elegíveis / 0 reutilizáveis / 29 no_reviews; `planSignature=e44e5996…`.

**EXECUTADO (B2.2B):** ✅ **51/51 digests `digest-v1` gerados**, custo real **$0.8578**, 0 falhas; escopo rígido. Detalhes em [PLANO3-LOTE-DIGEST-GOLDEN.md](PLANO3-LOTE-DIGEST-GOLDEN.md) §RESULTADO.

**MATERIALIZADO (B2.2C, 2026-06-20):** ✅ **`enriched-1` + pacote contextual cego congelados** (read-only; zero chamada paga). 51 `digest_available` + 29 `no_reviews_available`; sanitização determinística (nota-token e recomendação acentuada removidos → 0 restante); pacote offline validado (0 leakage; sem título/work_id; 90 cards). `enrichedSnapshotSignature=8b61084d…`, `contextualPackageSignature=9e4d1b9f…`. Ver [PLANO3-GOLDEN-SNAPSHOT-ENRICHED-MANIFEST.md](PLANO3-GOLDEN-SNAPSHOT-ENRICHED-MANIFEST.md). **PRONTO PARA ROTULAGEM HUMANA CONTEXTUAL.**
