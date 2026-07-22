# Registro — faixas de critério, barra de fit e artefato de build

**Data:** 2026-07-22 · **PRs:** #219, #220, #221, #222

Começou com uma pergunta sobre a UI ("por que a barra do card tem três informações?") e terminou em
quatro PRs, uma classe inteira de bug morta e uma investigação inteira em falso. Este documento
existe pra que ninguém — inclusive quem escreveu — refaça o caminho errado.

---

## 1. O que a barra mostra

`components/titles/criterion-fit-bar.tsx`, régua 0–10 (`posição = nota × 10`%), três camadas:

| Camada | O que é | Origem |
|---|---|---|
| 🩶 Faixa cinza | **Faixa ideal do seu perfil** pro atributo | `criterionPrefs[slug].ideal_min/max` |
| 🟩 Segmento colorido | **Faixa da rubrica** em que a nota cai | `bandForScore(nota)` |
| ⚪ Ponto branco | **A nota exata** | `category_scores` |

A cor do segmento vem da **nota**, não da faixa: `pickCriterionTierByRange` mede onde a nota cai
dentro da faixa ideal. Verde não significa "nota alta" — significa "bate com o seu gosto". Um
atributo com faixa ideal 2–6 (tragédia leve) pinta verde em 6,0 e amarelo em 7,0.

---

## 2. O bug raiz: os bins da rubrica não são contíguos

As rubricas usam quatro faixas — `0-3` | `4-6` | `7-8` | `9-10` — idênticas nos 9 critérios
(conferido em `CRITERIA_RUBRICS`). **Nenhuma contém 3,5 · 6,5 · 8,5.**

Desenhar `[lo, hi]` cru jogava toda nota de meio ponto pra fora do próprio segmento: o marcador
aparecia do lado de fora da faixa que a legenda dizia ser dele. Lê como defeito.

### Auditoria (7.983 atributos visíveis = última avaliação não-`failed` por obra)

| Marcadores fora do segmento | n |
|---|---|
| +0,5 acima do topo do bin (6,5: 67x · 8,5: 43x · 3,5: 22x) | 124 |
| −0,5 abaixo do piso (IA citou faixa acima da nota que deu) | 8 |
| Fora por >0,5 (regra de pós-processamento, nota editada, incoerência) | 73 |
| **Total** | **205** (2,64%) |

Reproduzir: `node scripts/audit-justification-bands.mjs` e `scripts/audit-bands-causes.mjs`
(read-only, paginados — cuidado com o corte de 1000 linhas do Supabase).

---

## 3. O segundo bug: contrato de saída em prosa

A faixa exibida vinha de **regex sobre a justificativa** (`^Faixa X-Y:`). Quando não casava,
`band = null` e a UI só encolhia — sumiam o chip e o segmento colorido, **sem erro e sem log**.

Experimento controlado nos dados, mesmo prompt `v20`:

| prompt · modelo | sem faixa |
|---|---|
| v19 · sonnet-4-6 | 0,2% |
| v20 · sonnet-4-6 | 0,2% |
| v20 · **sonnet-5** | 4,1% |
| v21 · **sonnet-5** | **5,1%** |

**20× pior só por trocar de modelo.** O `v19` já tinha resolvido isso no prompt; a migração pro
Sonnet 5 reintroduziu, e ninguém viu porque a falha é muda.

---

## 4. Decisões

### D1 — Bin semiaberto na geometria (#219)

O bin real é semiaberto: `7-8` cobre `[7, 9)`. `bandBarBounds` abre o topo (`hi + 1`, teto 10) e os
bins passam a se tocar. **Só a geometria**; o rótulo continua saindo de `collapseBand`, e
`bandBounds` fica intacto pra quem precisa dos limites crus.

> **Alternativa rejeitada:** manter `[lo, hi]` e aceitar o marcador fora. Rejeitada porque a barra
> passa a mentir sobre o próprio dado — o usuário lê como bug, e ele não é.

### D2 — Derivar a faixa da nota, no render (#220)

`bandForScore(nota)` resolve a faixa a partir da **nota vigente**, casando por `bandBarBounds`.

> **Alternativa rejeitada — pedir a faixa como `enum` no tool schema.** Era a proposta inicial. Força
> o formato pela API, mas **não garante coerência com a nota**: o modelo continua podendo declarar
> `7-8` e dar 6,5, e aí é preciso decidir quem ganha na hora de desenhar. Além disso só valeria pras
> avaliações NOVAS — as ~2.100 existentes continuariam quebradas, e reavaliar custaria dinheiro.
>
> **Alternativa rejeitada — derivar na ESCRITA** (compor a justificativa ao persistir). Congela de
> novo assim que a nota é editada, e exigiria migration + reprocessamento.
>
> Derivar **no render** ganhou nos três eixos: corrige o acervo inteiro na hora, acompanha edição de
> nota, e custa zero (sem prompt, sem schema, sem migration).

De quebra, o rótulo (`Saudável`, `Core Romance`) passou a sair sempre da **rubrica canônica** em vez
da paráfrase do modelo.

### D3 — A instrução de citar a faixa FICA no prompt

Poderia sair, economizando ~90 tokens de saída por avaliação. **Mantida de propósito:** ela ancora o
raciocínio do modelo nas rubricas antes de ele escolher o número, e tirar poderia degradar a
qualidade da nota. O que mudou é que a UI parou de **depender** dela.

### D4 — `.cache` fora do rastreamento de arquivos (#221)

`output: "standalone"` existe pra gerar imagem enxuta, mas o rastreador puxava
`.cache/comix-chrome/` (90 MB) — um browser que o servidor Next nunca executa; quem usa é o
`comix-render`, que tem a própria cópia. **143 MB → 51 MB**, e sumiram dois
`Failed to copy traced files` por build.

### D5 — `npm start` passa a subir o standalone de verdade (#222)

`next start` **não funciona** com `output: standalone` (o próprio Next avisa). `scripts/start-standalone.mjs`
faz localmente o que o Dockerfile faz nas linhas 21–23, mais uma coisa que o Docker resolve por fora:

- copia `public/` e `.next/static/` pra dentro do pacote — sem isso o servidor responde **200 com a
  página inteira sem CSS e sem JS**, falha que parece problema de estilo e não de deploy;
- injeta `.env.local`, porque o `server.js` gerado **não lê arquivos `.env`** (em produção quem
  injeta é a plataforma). Sem isso, toda página morre com `supabaseKey is required`.

> **Alternativa rejeitada — hook `postbuild`.** O Dockerfile chama `npm run build` na linha 15, então
> o hook rodaria dentro da imagem e duplicaria os estáticos no artefato.

---

## 5. Pendências mantidas de propósito

| Item | Por que fica |
|---|---|
| **~42 casos de nota fora da faixa por >0,5** (nota editada em peso ou incoerência genuína da IA) | Não é bug de exibição — depois do #220 a faixa acompanha a nota. O que sobra é divergência real entre o número e a prosa, e **a barra deve mostrar**. Esconder seria falsear |
| **5,1% de justificativas sem `Faixa X-Y:`** | Deixou de ter efeito na UI. Continua sendo sinal de que o Sonnet 5 ignora a instrução — ver a hipótese aberta abaixo |
| **9 justificativas legado do `external-import`** | Uma obra só (formato pré-"Faixa"). Some sozinho na próxima reavaliação. Não vale script |
| **Regras de pós-processamento e a prosa** | **Falso alarme — não é pendência.** As regras JÁ anexam a explicação ao texto (`service.ts:1035`: *"…couple_dynamics foi elevada para 5.0 (não aplicável)"*). Só a faixa do prefixo estava errada, e o #220 resolveu |

### Hipótese aberta, não medida

O prompt manda citar a faixa **pra ancorar o raciocínio** nas rubricas (D3). Em 5,1% dos atributos o
modelo não cita. **Ele ancorou?** Não sei. Medir exige comparar qualidade de nota entre avaliações
que citaram e que não citaram, e isso é confundido por modelo, prompt e obra ao mesmo tempo — só
vale dentro de uma calibração, onde o aparato já existe.

---

## 6. A investigação em falso — leia antes de "consertar o render"

Diagnostiquei um bug que **não existia**: a página da obra tinha 60 `<div>` no DOM contra 297 no HTML
servido, e 5 `div[hidden]` que eu li como conteúdo de `<Suspense>` órfão. Descartei com medição
**sete** hipóteses (headless, minha mudança, obra específica, load direto vs navegação, cache frio,
sessão, flags de automação) e cheguei a rodar build de produção.

**Eram abas do Radix.** A página tem 5: `Visão Geral · Notas & Avaliações · Meu Status ·
Recomendações · Gêneros e Tags`. Painel inativo é `div[hidden]` com zero filhos. Um clique levou de
60 pra **249 divs**.

Como não repetir:

- Antes de concluir qualquer coisa sobre renderização parcial, rode
  `[...document.querySelectorAll('[role=tab]')].map(t => t.innerText)` e **clique antes de medir**.
- `div[hidden]` com **0 filhos** e id começando em `radix-` é componente fechado, não órfão.
- `innerText` menor que o markup servido é o comportamento **normal** de uma UI com abas.
- `document.body.textContent` inclui o payload dentro de `<script>` — achar o texto ali **não** prova
  que renderizou.
- Prod e dev darem números **idênticos** era a pista mais forte: corrida de streaming daria números
  diferentes. "Determinístico" apontava pra estado de UI, não pra bug.

---

## 7. Invariante que passou a ser testada

`tests/unit/criteria/justification-band-bar.test.ts` cobre as **101 notas possíveis de 0 a 10**: toda
nota cai dentro do segmento da própria faixa, os bins são contíguos, e `bandForScore` é monotônica.
Antes o teste valia só pras notas de meio ponto.
