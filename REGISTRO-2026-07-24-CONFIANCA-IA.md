# Confiança da avaliação IA — réguas incomparáveis, normalização rejeitada, e a auditoria do prompt

**Data:** 2026-07-24 · **Base:** 2.296 avaliações `completed` (2.178 com confiança), 902 obras,
20.640 linhas de `ai_evaluation_scores`. Tudo re-medível com `scripts/diag-confidence-*.ts`
(só leitura).

**Gatilho:** a impressão de que "adiciono sinopse/reviews/tags e a confiança CAI". Ela era falsa, e
a tela de revisão a produzia.

---

## 1. O que foi corrigido (nesta PR)

A tela mostrava "Atual 93%" ao lado de "Sugerido 75%" — mesmo tamanho, mesma escala de cor, sem
dizer que vieram de **modelos diferentes**.

A causa não era de design: [`loadCurrentEvaluationMeta`](server/actions/ai.ts) fazia
`select("id, confidence, created_at, …")` e **não lia `model_name` nem `prompt_version`**. O
componente não tinha o dado pra avisar.

| medida | valor |
|---|---|
| obras cujo "Atual" vem de config ≠ da ativa | **680 de 901 (75%)** |
| obras com confiança atual **acima do teto** do sonnet-5 (0,88) | **50 (6%)** |
| avaliações sonnet-5 com confiança ≥ 0,90 | **0 de 371** |
| valores distintos de confiança em 2.178 avaliações | **21** |

As 50 são o caso em que reavaliar **sempre** "piora" o número — aritmeticamente, sem que nada tenha
piorado. É o subconjunto que produz a conclusão errada de forma garantida.

Correção: procedência (`modelo/versão · data`) sob cada número; cor semântica **neutralizada** no lado
"Atual" quando a régua difere (a escala verde/amarelo/vermelho dos dois lados era metade do convite a
comparar); e um aviso que **só aparece quando a config difere** — nas 221 obras já em `sonnet-5/v21`
a comparação é legítima e a tela deixa comparar. Lógica pura em
[`lib/ai-evaluation/confidence-ruler.ts`](lib/ai-evaluation/confidence-ruler.ts), com 13 testes.

Corrigido também o **tooltip da confiança**, que afirmava o contrário dos dados: dizia refletir "a
consistência da evidência, NÃO a quantidade de reviews". A relação com a quantidade é monotônica
(0 reviews → 0,651 · 1-5 → 0,751 · 6-15 → 0,792 · 16-30 → 0,802 · 31-60 → 0,812 · 61+ → 0,839).

---

## 2. Normalizar a confiança entre modelos: REJEITADO

Quatro opções avaliadas contra os dados.

| opção | obstáculo medido | veredito |
|---|---|---|
| quantil dentro da config | `0,75` = **38%** da config ativa → o percentil desse valor é o intervalo **25–63**, não um ponto | ✗ |
| exibir percentil | idem, com falsa precisão na tela (13 valores distintos em 242) | ✗ |
| z-score por config | **σ varia 3,5×** (0,029 … 0,103): dividir por σ *amplifica* a config comprimida. 0,75→0,80 vale +0,77σ no v21 e +0,49σ no v17 | ✗ |
| **rotular / não comparar** | exige `n = 0` | ✓ |

**O diagnóstico que muda a conclusão:** as distribuições não estão *deslocadas*, estão **truncadas**.
Medianas 0,82/0,75/0,82/0,82 (sonnet-4-6) vs 0,75/0,75 (sonnet-5); p10 0,62 vs 0,60–0,70. O que
difere é o **teto** (0,95 vs 0,88). Z-score corrige localização e escala — conserta o que não está
quebrado e mexe no que está certo.

### Onde moraria o valor nivelado

- **Coluna persistida: errado.** A distribuição é alvo móvel — `sonnet-5/v21` foi de n=0 a n=242 em
  12 dias. Um percentil gravado com n=50 mente com n=242; manter correto exigiria reescrever as 2.178
  linhas a cada avaliação nova. É a armadilha do estatístico derivado persistido.
- **Cálculo na leitura: caro.** Varrer 2.178 linhas por render, com banco remoto (~300ms/round-trip).
- **Único desenho defensável:** tabela `confidence_config_stats` (~26 linhas: cfg, n, p10…p90,
  min, max) atualizada por `after()`/cron + mapeamento na leitura. Três peças novas pra melhorar um
  rótulo de 21 valores.

### Cold start

Decis estáveis pedem **n ≥ 100**; tercil grosso, **n ≥ 30**. Hoje as configs com n<30 respaldam
**3 obras** — exposição quase nula.

**A ironia fatal:** o dia em que a normalização é indispensável é o dia da troca de modelo, e nesse
dia a config nova tem **n = 0**. Os fallbacks possíveis são dois — mostrar o bruto com rótulo (= a
opção escolhida), ou emprestar a distribuição da config anterior (= assumir exatamente a
comparabilidade que se quer provar). Não há terceiro. **A normalização fica indisponível justamente
quando o problema existe.**

### Retroatividade

**Sim, mecanicamente:** é transformação *dentro* da config, sem reavaliar nada — 2.178 valores, 26
configs, de graça. Esse era o único ganho real. Mas ele cai onde o problema é menor: 17 das 26
configs têm n<50 e respaldam ~3 obras, e as 7 grandes já têm medianas 0,75–0,82. O buraco é no teto.

### O que NÃO fazer com isso

A confiança mede **volume de evidência** (rho 0,44 com reviews substantivas · 0,41 nº de fontes ·
0,41 nº de tags · 0,13 sinopse). Qualquer transformação monotônica dela **continua** medindo volume
de evidência — só troca a unidade. Nivelar não a transforma em medida de acerto.

Sobre acerto: rho −0,078 com a correção humana, **mas o teste é sem poder** — o humano edita 0,1–4%
dos critérios (erro médio 0,007–0,057 em escala 0–10), então o ground truth é quase constante. A
conclusão correta é "não dá pra saber com esse rótulo", **não** "a confiança é descalibrada". Medir
acerto exigiria outro rótulo: re-notar N obras às cegas de propósito.

**O que já é comparável entre modelos** são os contadores de evidência, porque não é o modelo que os
reporta — é o input que controlamos. Já estão em `raw_response.evaluationContext`
(`sourcedReviewsAfterDedup`, `tagsCount`, `genresCount`, `externalContextCount`, fontes distintas em
`sourcedReviews[].source`). Cobertura: 100% em v20/v21, 90% em v18/v19, **75% em v17**. Exibir o
delta disso na tela de revisão é a variante "C" do mockup — **não implementada**, disponível em cima
do que já está aqui.

---

## 3. Auditoria do prompt: achados PENDENTES

Nada aqui foi alterado. Decisão consciente: qualquer mudança no `SYSTEM_PROMPT` cria a **config nº 27**
— uma régua nova — logo depois de construirmos a UI que avisa sobre trocas de régua. Como a UI já não
depende do texto da faixa (#220), nenhum destes achados tem consequência visível hoje. **Agrupar com
a próxima mudança deliberada de prompt** (a reversão da promo do Sonnet 5, ago/2026), quando a
descontinuidade já vai ser paga.

### ✅ Verificado: NÃO há drift entre banco e prompt

9/9 critérios com `ranges`, `description` e nome **idênticos** entre a tabela `criteria` (eval_type=IA)
e `lib/constants/criteria.ts`. `buildCriteriaPromptSection()` monta a seção de rubricas a partir do
arquivo gerado, então **a rubrica do prompt É o banco**. Conferido, não assumido.

### ⚠️ #1 — Os bins não contíguos ainda vivem no prompt

O fix #219/#220 consertou a **UI** (a faixa exibida deriva da nota); a **fonte** segue. O prompt
declara `0-3 | 4-6 | 7-8 | 9-10`, e ao mesmo tempo manda "Use decimais (ex: 7.5)" **e** "cite
EXPLICITAMENTE qual faixa foi escolhida".

**Medido: 1.399 de 20.640 notas (6,78%) caem fora de toda faixa declarada** — 6.5 (677×), 8.5 (512×),
3.5 (182×), mais alguns 6.3/3.8/3.3/6.8. O modelo é obrigado a citar uma faixa inexistente em 6,78%
das notas que ele mesmo produz.

É a hipótese mais simples pro "20× mais sem faixa" do Sonnet 5 registrado em
`REGISTRO-2026-07-22-FAIXAS-DE-CRITERIO.md` — e é testável. Correção: bins semiabertos em
`criteria.ranges` + `sync-constants`.

### ⚠️ #2 — A regra de escala proíbe o 4 que a rubrica declara

`INTERPRETAÇÃO DA ESCALA` diz "Notas 0-4 são RESERVADAS pra casos onde o critério é claramente
ausente… se há QUALQUER evidência… a nota deve ser ≥ 5". A rubrica declara a faixa **"4-6 Subplot"**.
Para os 7 critérios positivos, a faixa 2 é de fato **5-6** — o 4 está proibido e declarado ao mesmo
tempo.

### ⚠️ #3 — Três instruções empilhadas sobre o valor dentro da faixa

"escolha a faixa inferior MAS use o valor MAIS ALTO dela" (entre faixas) + "prefira o valor CENTRAL"
(dentro da faixa) + "não use a regra de incerteza como atalho pro neutro". Os escopos são diferentes,
então não é bug — mas é frágil: cada modelo novo relê essa pilha. Explica o acúmulo em 5,0
(340 de 2.293 notas de `couple_dynamics`, o centro da faixa 4-6).

### ⚠️ #4 — `couple_dynamics = 5.0` carrega dois significados

`enforceNeutralCoupleDynamicsWhenNoRomance` grava 5.0 querendo dizer "não aplicável"; na rubrica 5.0
é "Faixa 4-6 (**Conflituosa**)". A UI rotula como Conflituosa enquanto a justificativa diz "não
aplicável".

**Magnitude real: a regra disparou 20× em 2.296 avaliações (3 em v21)** — pequeno. As 134 obras em
`couple_dynamics = 5.0` são quase todas escolha do próprio modelo (ver #3), não injeção da regra.

### ⚠️ #5 — A regra de couple_dynamics está escrita três vezes

Rubrica 0-3 no banco + `REGRA PARA COUPLE_DYNAMICS` + `AVALIE O DESENVOLVIMENTO`. Uma no banco, duas
no código: mexer na rubrica via `sync-constants` **não** atualiza as outras duas.

### 🔴 #6 — `CONCISE_OUTPUT = false` NÃO é o rollback que o comentário promete

[`lib/ai-evaluation/service.ts`](lib/ai-evaluation/service.ts) linhas ~118-123 dizem que virar o flag
"reverte o prompt E a versão de volta pra v18, reaproveitando os caches antigos". As duas afirmações
são falsas:

1. Sai apenas o bloco conciso do **user** prompt (`if (CONCISE_OUTPUT)`, ~linha 842). O
   `SYSTEM_PROMPT` inteiro — com as regras v21 de consenso, "NUNCA cite uma review individual nem
   IDs" — **fica**. Resultado: avaliações rotuladas `v18` com semântica v21.
2. `EVAL_OUTPUT_SCHEMA_VERSION = "eval-2"` é constante e entra na chave de cache
   (`buildCacheKeyObject` → `output_schema_version`). As avaliações v18 originais (mai/2026) são
   pré-`eval-2`, então **os caches antigos não são reaproveitados**.

Correção pendente: ou o flag passa a alternar o `SYSTEM_PROMPT` e o `EVAL_OUTPUT_SCHEMA_VERSION` de
verdade, ou o comentário para de prometer um rollback que não existe. **Uma linha, custo zero** — não
aplicada aqui só pra manter esta PR restrita ao que foi decidido.

### 🔴 #7 — CLAUDE.md está impreciso sobre o piso do R19

CLAUDE.md diz que `enforceR19AdultContentRule` "raises `adult_content` to ≥ 7.0". O código tem **dois
pisos**: `level === "strong"` → 7.0, `"weak"` → 6.0. A rubrica no banco diz "(piso 6.0)". Código e
rubrica estão coerentes; **a doc está errada**. Uma linha, custo zero.

### Aferições de passagem

| flag de pós-processamento | disparos em 2.296 avaliações |
|---|---|
| `r19AdultContentRuleApplied` | **349 (15%)** |
| `externalContentRatingRuleApplied` | **164 (7%)** |
| `neutralCoupleDynamicsRuleApplied` | 20 (0,9%) |
| `confidenceCapWhenLowEvidenceApplied` | **0** |

O teto de baixa evidência (`LOW_EVIDENCE_CONFIDENCE_CAP = 0.55`) **nunca disparou** — é código morto
na prática. A condição exige sinopse < 50 chars **E** sem contexto externo **E** menos de 3 reviews
substantivas; nenhuma avaliação real bateu nas três.

---

## 4. Custo (medido, não estimado)

`ai_api_calls`, operation `ai_evaluation`, n=263 na config ativa: mediana **5.893** tokens de input +
**12.606** de cache-read + **1.424** de output = **US$ 0,0344 por avaliação** (p90 US$ 0,0614),
latência mediana 18s.

| ação | custo |
|---|---|
| Esta PR (UI + procedência + scripts) | **US$ 0** — nenhuma chamada de IA |
| Corrigir os bins/#2/#5 no prompt, sem reavaliar | só `cache_creation` nas avaliações novas |
| Reavaliar as 902 obras pra uniformizar o histórico | **≈ US$ 31** (p90 ≈ US$ 55) |

---

## 5. Como re-medir

```bash
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-confidence-evidence.ts
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-confidence-confound.ts
npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-confidence-calibration.ts
```

Os três são **só leitura**. O `pageAll` duplicado neles virou `scripts/lib/page-all.ts`, com o
tamanho de página parametrizado: a condição de parada deriva do mesmo `pageSize` que monta o `range`,
então baixar de 1000 pra 200 (necessário no `evidence`, que lê `raw_response` e estourava o statement
timeout) não pode mais truncar a leitura em silêncio. O `evidence` ainda confere o total paginado
contra `count: "exact"` e **falha** se divergir.

**Re-medir os tetos ao trocar de modelo** e atualizar `OBSERVED_CONFIDENCE_MAX` em
`lib/ai-evaluation/confidence-ruler.ts` — é a constante que sustenta a frase "nunca passou de X%".
