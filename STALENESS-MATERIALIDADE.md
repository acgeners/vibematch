# Staleness por materialidade — perfil de gosto e Interesse na obra

Registro de trabalho e decisões (2026-07-05, branch `feat/profile-staleness-materiality-gate`).
Duas frentes irmãs: **(A)** reduzir a sensibilidade do "desatualizado" do **perfil de gosto**;
**(B)** matar o churn de re-previsão do **Interesse na obra** que vinha do perfil.

---

## 0. Problema de origem

O status "desatualizado" era binário e disparava a **cada edição** (1 nota, 1 tag):

- **Perfil de gosto** — stale via igualdade crua de `input_hash` (hash das obras rotuladas).
  Consequências: (1) nag na UI a cada mexida; (2) **auto-regeneração paga (~$0,40)** no chat/
  recomendação, pois `loadOrEnsureProfile({refreshIfStale:true})` regenerava sempre que o
  `input_hash` mudava.
- **Interesse na obra** — staleness chaveada em `computeProfileSignature` (o **output LLM** do
  perfil), que muda 57–73% a cada regeneração do MESMO acervo ⇒ todo regen marcava ~todas as
  previsões como stale.

Pedido do Geners: acumular alterações até um nível que justifique o recálculo, **enviesado
liberal** (catálogo pré-filtrado ⇒ baixa dispersão ⇒ poucas edições quase nunca movem o gosto).

---

## A. Gate de materialidade do perfil (θ = 0,15)

### Diagnóstico
A peça-chave já existia: `getProfileDrift` (`lib/ai-recommendation/profile-drift.ts`) computa um
**fingerprint heurístico** determinístico ($0) e um `driftPct` (1 − Jaccard médio das tags
amadas/evitadas). Só não estava plugado no gate — era informativo. O `input_hash` decidia tudo.

### Calibração empírica
Script re-rodável: `scripts/calibrate-profile-drift-threshold.ts` (offline, determinístico).
Leave-k-out sintético na biblioteca real (200 obras) — quanto o `driftPct` sobe conforme as
edições **acumulam**:

| obras acumuladas | média | p90 | P(≥0,10) | P(≥0,15) |
|---|---|---|---|---|
| 1 | 0,029 | 0,063 | 2% | 1% |
| 3 | 0,054 | 0,095 | 9% | 2% |
| 5 | 0,083 | 0,156 | 27% | 13% |
| 8 | 0,100 | 0,180 | 39% | 20% |
| 12 | 0,136 | 0,235 | 59% | 38% |

Confirma o palpite: **1 edição quase nunca move o gosto** (p90 = 0,063). Re-rating pesa mais que
adicionar obra (muda a correlação point-biserial que decide amada/evitada).

### Decisão — gate composto, θ = 0,15
`classifyProfileStaleness` (puro, em `profile-drift.ts`):

```
stale = driftPct ≥ 0,15                 (magnitude do drift heurístico)
     OU fraçãoObrasNovas ≥ 0,15         (rede p/ o ponto cego temático: heurístico não lê sinopse)
     OU idadeDias ≥ 90                  (drift lento + updates de modelo/prompt)
```

- **θ = 0,15 liberal**: single edit dispara ~1%; precisa de ~5–8 obras acumuladas pra virar
  provável. Escolhido no limite liberal porque a descoberta colateral (abaixo) mostra que ser
  liberal **não custa qualidade**, só economiza $.
- **Separação identidade × staleness**: `input_hash` deixa de decidir staleness e continua sendo
  a **identidade/dedup** da geração. Só a decisão fresh×stale passou a olhar o `driftPct`.
- **Fallback legado**: perfis sem `heuristic_fingerprint` (pré-migration 118) caem na regra
  antiga (input_hash).

### Arquivos
`profile-drift.ts` (gate + constantes), `taste-profile.ts` (fingerprint exposto no
`TasteProfileRow`), e os 4 caminhos rewired: `classifyTasteProfileReadiness`+`ensureTasteProfile`
(orquestração), `loadOrEnsureProfile` (`ensure-profile.ts`), `getProfileDrift`,
`getTasteProfileStatusAction` (`server/actions/recommendations.ts`).

### Verificado no DB real
Perfil v19 (200 obras): `driftPct = 0,125` → agora **fresh** (antes: stale permanente a cada
edição). +8 testes; tsc verde.

---

## B. Churn do Interesse na obra (chave determinística)

### Descoberta colateral (a raiz)
Regenerar o **mesmo acervo** dá perfil LLM **57–73% diferente** (namesDrift 0,42–0,62; fullDrift
0,66–0,73) — ruído de sampling a **temperatura 0,2** (`generateTasteProfile`). Como a staleness do
Interesse usava `computeProfileSignature` (output LLM), **todo regen marcava ~todas as previsões
stale**, independente do input mudar.

### Experimento (validação da premissa)
Previ 10 obras contra v18 × v19 (que diferem 62% nas tags):

| | |
|---|---|
| Nível de Interesse **idêntico** | 60% |
| Dentro de **±1** | 100% |
| **\|Δnível\| médio** | **0,40** |

Δ = 0,40 ≈ MAE do próprio preditor (~0,44–0,50, Plano 3). Leitura: os dois perfis são amostras
**igualmente válidas** do mesmo gosto; re-prever num regen **não deixa mais correto — só
re-amostra dentro do ruído**. Logo re-rodar em regen é sempre desperdício.

### Decisão — chave determinística + invalidação gated + dual-read
1. **`computeProfileStalenessKey(profile)`** (`taste-profile.ts`) = hash do `heuristic_fingerprint`
   determinístico (fallback `computeProfileSignature` sem fingerprint). Regen do mesmo acervo →
   mesmo fingerprint → **mesma chave** → zero churn.
2. **Store** grava a chave nova: `synopsis-quality-runner.ts`, `persistPrediction`
   (`synopsis-interest.ts`), backfill, batch planner.
3. **Invalidação gated por materialidade** em `insertNewTasteProfile`: só chama
   `markSynopsisPredictionsStale` se o fingerprint do perfil novo ≠ do anterior. Regen do mesmo
   acervo **não toca a coluna `stale`** (mata o flip na fonte, sem migração de dados).
4. **Dual-read de transição** em `classifyInterestReadiness` e `planInterestBatch`: casam contra
   a chave nova **OU** a antiga (`*Legacy`). Linhas gravadas antes da migração seguem **fresh**.
5. **Backfill** usa a chave nova **sem** dual-read: um backfill explícito re-prevê linhas de
   chave-antiga = migração intencional (é o trabalho dele).

### Transição (por que dual-read, e não troca direta)
Escolha do Geners. Verificado no DB (read-only): das **535** previsões frescas, **535/535** casam
pela chave antiga ⇒ dual-read as mantém frescas ⇒ **zero flip de "desatualizado" no deploy**.
Novas previsões usam a chave estável; o catálogo migra sozinho conforme é re-previsto.
(Os `*Legacy` são removíveis quando o catálogo tiver migrado.)

### Arquivos
`taste-profile.ts` (nova função + invalidação gated), `synopsis-quality-runner.ts`,
`integrations/synopsis-interest.ts` (classify dual-read + caller + persist + batch planner),
`backfill/interest-backfill.ts`, `server/actions/synopsis-quality.ts`. +5 testes; tsc verde.

---

## Follow-up latente #3 — instabilidade ±1 por amostra de perfil

**NÃO feito. Provavelmente não vale a pena agora.** Registrado pra não fingir que o fix (B)
"resolveu a instabilidade" — ele resolveu o **churn/custo**, não a **variância por amostra**.

- **O quê:** o perfil é gerado a temp 0,2 ⇒ cada regeneração é uma **amostra ruidosa** do gosto.
  O experimento mostrou que 40% das obras mudam 1 nível de Interesse dependendo de **qual amostra
  de perfil** estava ativa. Ou seja, a previsão de uma obra não é totalmente determinada pelo
  gosto — depende da amostra.
- **Por que é latente:** essa oscilação (≈0,40) está **dentro do MAE** do modelo (~0,44–0,50).
  Não é erro novo empilhado — já É boa parte do que faz a previsão ser ±0,5. Previsões são
  filtro/ranking, não nota fina.
- **Alavancas, se um dia incomodar:**
  - **baixar a temperatura** (0,2 → 0): perfil mais determinístico entre regens → menos oscilação.
    ~$0, mas perfil fica mais "seco" (resumo/temas menos ricos). É o experimento barato.
  - **averaging/ensemble**: gerar perfil (ou previsão) N× e tirar média/voto → ruídos se cancelam.
    N× o custo LLM. Só se quiser precisão fina.

---

## Decisões-chave (resumo)

| Decisão | Escolha | Base |
|---|---|---|
| Métrica de staleness do perfil | materialidade (fingerprint) + tetos fração/idade | mede o delta do gosto, não a edição; já existia $0 |
| θ do drift | **0,15** (liberal) | calibração: single edit ~1%; ser liberal não custa qualidade (ruído do perfil) |
| `input_hash` | vira só identidade/dedup | separar "quem é" de "está velho" |
| Chave de staleness do Interesse | fingerprint determinístico, não output LLM | output re-rola 57–73% por regen |
| Re-prever em regen? | **não** | Δ nível ≈ MAE ⇒ resampling, não melhoria |
| Invalidação | gated por materialidade na fonte (`insertNewTasteProfile`) | mata o flip sem migração de dados |
| Transição | **dual-read** (não troca direta) | 535/535 frescas preservadas, zero flip no deploy |
| Backfill | chave nova sem dual-read | re-previsão de chave-antiga = migração intencional |

## Scripts deixados
- `scripts/calibrate-profile-drift-threshold.ts` — calibração do θ (offline, re-rodável).
  (O experimento de sensibilidade do Interesse e a verificação da transição foram one-offs
  descartados — faziam chamadas pagas / eram checagens pontuais.)

## Estado
Parte A commitada; parte B + este doc no mesmo branch. Sem migração de banco. `MIN_TRAIN`/
recalc/personal_fit inalterados. Próximo passo opcional = follow-up #3 (se a instabilidade
aparecer na prática).
