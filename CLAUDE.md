# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # starts on http://localhost:3001 (not 3000)
npm run build
npm run test         # vitest run (all tests once)
npm run test:watch   # vitest watch mode
npx vitest run tests/unit/calculations/score.test.ts  # single test file
npm run sync-constants  # regenerates constant files from Supabase DB (requires SUPABASE_SERVICE_ROLE_KEY)
npm run lint
```

`sync-constants` needs `SUPABASE_SERVICE_ROLE_KEY` in env. It overwrites the files listed in the **Constants generated from DB** section below — never hand-edit them.

## ⚠️ O banco NÃO tem backup — faça um antes de mudança grande

Conferido na Management API (2026-07-13): **`pitr_enabled: false` e ZERO backups disponíveis**. Não
existe de onde restaurar. E parte do dado é cara de refazer: ~2.100 avaliações de IA (**≈US$60 em
tokens**) e ~14 mil reviews raspadas de 8 fontes.

```bash
node scripts/backup-db.mjs        # → .backups/<timestamp>/ (gitignored)
```

Dump lógico de todas as tabelas em NDJSON gzipado (24 MB / ~120k linhas hoje). **Pagina e confere
contra `count: "exact"`**: se faltar uma linha, ele FALHA em vez de gravar um backup truncado — que é
a pior forma possível do bug das 1000 linhas, porque você só descobre quando precisa restaurar.

**Retenção:** depois de um backup bem-sucedido o script mantém os **5 mais recentes** e apaga os
antigos (só dirs com nome de stamp ISO) — sem isto o `.backups` cresce sem limite (~30M/execução).
Ajuste com `BACKUP_KEEP=<n>`.

Rode antes de: partição per-user (Fase 2), backfill em massa, qualquer migration que dropa coluna.

**Cache de dev incha:** o `.next/dev` (cache do Turbopack) chega fácil a **dobra dígito de GB**. Não
tem teto configurável — limpe periodicamente com `npm run clean` (`rm -rf .next .turbo`; regenera no
próximo `npm run dev`, só a 1ª compilação fica mais lenta). Confira `next-server` órfãos antes
(`pkill -f next-server`): cada dev server zumbi segura o cache e infla o `.next`.

## ⚠️ Egress: o plano free tem 5 GB/ciclo, e desenvolver contra a nuvem estoura

Em 2026-07-29 o projeto foi **restrito** (`exceed_egress_quota`, 16,76 GB contra 5 GB inclusos). O
sintoma engana: o gateway devolve **402 em tudo**, e o erro aparece na UI como Runtime Error apontando
uma `select` inocente de 1 coluna — a primeira query a estourar leva a culpa. Prova de que é infra:
`/auth/v1/health` (que nem toca o Postgres) também dá 402. Postgres direto na 5432 e o endpoint de SQL
da Management API continuam funcionando mesmo restrito — é assim que se tira o dump com o app fora do ar.

**Custo por operação, medido no PostgREST (sem compressão):**

| Operação | Payload |
|---|---|
| 1 página de `/titles` (24 obras, `WORK_LIST_SELECT`) | **569 KB** |
| idem, trocando `work_tags(tag_id, tags(*))` por 4 colunas | 330 KB (**−42%**) |
| catálogo inteiro com o mesmo select (966) | **20,1 MB** |
| um `recalculateAll` (só a leitura de `works`) | **5,3 MB** |

Auth é 0–3% do egress; **PostgREST é 97–100%**. Há três consumidores: curadoria, navegação/dev e
**scripts de análise** — este último é o mais fácil de esquecer e explica o pico do mês (1,47 GB num dia
com zero escrita de curadoria). **Quebrar a tabela `works` não ajuda**: `review_digest` +
`review_summary` + `canonical_synopsis` são 78% dela e o `WORK_LIST_SELECT` não pede nenhuma. O peso
está nos joins embutidos.

## Desenvolver contra o Supabase LOCAL

```bash
supabase start                 # stack local: API 54321, Postgres 54322, Studio 54323
npm run db:pull                # pg_dump da nuvem → local (DESTRÓI public/bkp do local)
npm run db:local               # aponta o .env.local pro stack local
npm run db:cloud               # volta pra nuvem
npm run db:push-evals -- --yes # leva avaliações de IA feitas no local pra nuvem
```

`db:local` também redireciona **os 23 de 44 scripts do `package.json` que rodam com
`--env-file=.env.local`** (`pilot2:*`, `baselines:ranking`, `e1:*`) — eles leem o catálogo várias vezes
por execução, então rodá-los no local é o maior corte de egress disponível, de graça.

`[db.migrations] enabled = false` no `config.toml` é **de propósito**: as 173 migrations foram aplicadas
via Management API, têm colisões de número e nunca rodaram do zero. Quem popula o local é o `pg_dump`.

**O banco local é refeito a cada `db:pull`.** Existem DOIS caminhos de volta:

```bash
npm run db:push-evals -- --yes        # só a avaliação de IA (5 tabelas)
npm run db:push-curation -- --dry-run # curadoria INTEIRA: "Atualizar dados" + avaliação +
npm run db:push-curation -- --yes     #   estado de leitura + saídas do recalc (18 tabelas)
```

O `db:push-curation` cobre o que foi **medido** num piloto real, não deduzido do código —
foi assim que apareceram `work_processing_jobs`, `ai_cache_events` e o fato de
`canonical_synopsis` ser um artefato pago próprio. Ferramenta que fecha o escopo:

```bash
npm run db:fingerprint snap antes    # … faz a operação no app …
npm run db:fingerprint snap depois
npm run db:fingerprint diff antes depois   # toda tabela que aparecer precisa estar no PLAN
```

Ele usa **hash de conteúdo, não contagem**: "Atualizar dados" mexe em dezenas de colunas de
`works` sem criar linha — num diff por contagem isso é invisível.

**Fora do push, de propósito:** `formula_config` (mistura saída do modelo com CONFIGURAÇÃO do
usuário — faixas, cores, atalhos de nota), `external_source_health` e `genre_proposal` (derivados).

⚠️ **`--dry-run` dá rollback e SAI ANTES da conferência** — o caminho do COMMIT e todo o código
de verificação ficam sem execução. Ensaie de verdade contra um clone descartável:

```bash
npm run db:cloudsim   # clone da nuvem no Postgres local, a partir do dump do db:pull
npm run db:push-curation -- --target='postgresql://postgres:postgres@127.0.0.1:54322/cloudsim'
```

Foi esse ensaio que pegou o `trg_works_updated_at` (BEFORE UPDATE, `NEW.updated_at = now()`):
o destino reescreve a coluna, então ela **nunca** bate e não serve de invariante.

🔴 **Login no local não funciona de cara:** os usuários são Google-only (`encrypted_password`
NULL) e o `config.toml` vem com todo provider externo `enabled = false` — dá
`Unsupported provider`. O `/login` tem formulário de e-mail+senha, então crie uma senha só no
local (`update auth.users set encrypted_password = extensions.crypt('…', extensions.gen_salt('bf'))`).
Refazer depois de cada `db:pull`. Desde 2026-08-06 há também **"Esqueci minha senha"**
(`/recuperar-senha` → e-mail → `/nova-senha`), e no local o e-mail cai no **Mailpit** (`:54324`).

🔴 **PENDENTE: a recuperação de senha NÃO funciona em produção — falta SMTP.** Medido na
Management API (2026-08-06): `smtp_host`, `smtp_user`, `smtp_pass` e `smtp_admin_email` são
**todos `None`**, `hook_send_email_enabled = false`, e `rate_limit_email_sent = 2` **por hora, no
projeto inteiro**. Com o provedor embutido do Supabase — que é declaradamente de desenvolvimento —
o e-mail não chega de forma confiável a usuário real. **O código está pronto e testado ponta a
ponta; o que falta é só configuração.** Três consequências que se explicam mal quando se esquece
disto:

1. **Traduzir os e-mails é o MESMO item.** `PATCH /v1/projects/{ref}/config/auth` devolve **400**:
   *"Email template modification is not available for free tier projects using the default email
   provider."* Os templates em português já existem em `supabase/templates/*.html` e valem **só no
   local** (via `[auth.email.template.*]`); sobem pra nuvem no dia em que houver SMTP.
2. **Sem domínio próprio, Resend/SendGrid/Mailgun não servem** — exigem domínio verificado
   (SPF/DKIM) pra enviar a terceiros; sem isso só deixam mandar pra você mesmo. O app é
   `satoria.fly.dev`, sem domínio. Então a escolha real é **"Gmail com App Password agora"** ou
   **"domínio próprio primeiro"**, não "Gmail vs. provedor de verdade".
3. **Gmail resolve, com dois preços.** `smtp.gmail.com:587` + App Password (exige 2FA na conta).
   Mas o Gmail **reescreve o `From`** pro endereço autenticado — um e-mail de redefinição de senha
   sai de um Gmail pessoal, que é o formato que as pessoas aprenderam a tratar como phishing. E é
   uso fora do previsto pra conta pessoal. Pro volume atual (3 contas) o teto de envio não pesa.

✅ O que **já** está certo na nuvem, não mexer achando que é pendência: `site_url` =
`https://satoria.fly.dev` e a allow-list já cobre `satoria.fly.dev/**`, `localhost:3001/**` e
`127.0.0.1:3001/**`.

⚠️ **`supabase start` decide o projeto pelo DIRETÓRIO ATUAL.** Rodado de outra pasta, ele sobe um
stack PARALELO com config default nas MESMAS portas — e aí `psql :54322` responde
`relation "public.works" does not exist`, como se o banco tivesse sido apagado. Não foi: o do
projeto está parado no volume dele. Quem denuncia é o nome do container
(`docker ps | grep supabase_auth` → `supabase_auth_animedb-pag_obra` é o certo). Sempre `cd` no
projeto antes, ou passe `--project-id` — inclusive no `stop`, que erra o alvo do mesmo jeito.

🔴 **Signup no local não provisiona `user_settings`:** o `db:pull` dumpa só o schema `public`, e o
trigger `on_auth_user_created` (mig 137) mora em **`auth.users`** — a FUNÇÃO `handle_new_user` vem
no dump, o TRIGGER não. Sem ele, conta nova fica sem linha de settings (sem display_name, sem
preferências — `setHideAdultContent` falha com "sem linha pro usuário atual"). Recriar depois de
cada `db:pull`:

```sql
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

**Corolário de backup:** este `pg_dump` é hoje o **único** backup que inclui schema, policies e
functions. O `scripts/backup-db.mjs` grava **só dado** (as 162 functions, 47 policies, 11 triggers e 2
views do `public` não vão nele), e `supabase/migrations/` não reconstrói o banco.

## Architecture

Next.js 16 App Router (Turbopack). Todo acesso ao banco é server-only, e há **dois clientes** — escolher o
errado não dá erro, dá dado errado:

| Cliente | Use para | RLS |
|---|---|---|
| `createAdminClient()` (service role) | **catálogo** (works, tags, reviews, category_scores…), curadoria, e tudo que roda **sem sessão**: fila de recalc, `after()`, cascatas, scripts | **ignorada** — o `user_id` tem que vir explícito no argumento, nunca implícito no "usuário corrente" |
| `createUserClient()` (sessão, `lib/supabase/user.ts`) | **escrita de dado per-usuário** vinda de uma requisição | **vale** (migration 142): o Postgres filtra por `user_id = auth.uid()` |

As duas trocas erradas, e o que cada uma faz **em silêncio**:
- **Cliente de usuário numa leitura de catálogo** → 0 linhas. `submitPostReadingAttributes` responderia
  "obra sem avaliação IA" — uma mentira plausível, sem erro nenhum.
- **Service role numa escrita per-usuário** → volta a depender de o código lembrar do `.eq("user_id")`.
  Esquecer não dá erro: escreve na linha de outra pessoa (foi exatamente o buraco do PR #127).

**As leituras de background continuam na service role de propósito.** O recalc lê `attribute_bias` e
`user_tag_preferences` do dono **sem sessão**; com o cliente de usuário ele veria zero linhas e
recalcularia as notas dele **sem a calibração dele** — sem erro, sem log, só notas erradas.

**Auth existe** (esta linha já disse o contrário — não confie na memória, confira): Supabase Auth com
`/login`, `/signup` e **logout no menu do avatar na barra superior** (`components/layout/account-chip.tsx` →
`signOutAction`). Quem autoriza é o **papel** (`user_settings.role` → `lib/plans/roles.ts`,
`ensureAdmin`/`roleAllows`), verificado dentro das actions.

**O `middleware.ts` gateia DUAS famílias, com exigências diferentes.** Ele refresca a sessão em
toda rota e, só nesses prefixos, decide:

| Lista | Prefixos | Exigência |
|---|---|---|
| `CONSOLE_PREFIXES` | `/curadoria`, `/ai-evaluation`, `/settings`, `/ai-usage`, `/admin` | sem sessão → `/login`; logado não-curador → `/` |
| `SIGNED_IN_PREFIXES` | `/conta`, `/painel` | sem sessão → `/login`. **Papel não importa** |

**Todo o resto segue sem gate de rota** — visitante anônimo carrega `/titles`, `/leitura`,
`/favorites`, `/ranking`, `/import` e `/recommendations`, que é o desenho: o catálogo é
compartilhado, e os leitores per-usuário devolvem vazio sem sessão (medido rota a rota em
2026-08-09).

🔴 **As duas listas são separadas porque `/conta` e `/painel` exigem IDENTIDADE, não papel.**
Herdar a checagem de curador jogaria todo leitor logado pra `/` — trancando fora justamente quem
essas páginas descrevem. Daí o `if (!isConsole) return response` logo depois do `if (!user)`.

🔴 **As duas entraram em 2026-08-09 por vazamento MEDIDO, não por precaução.** `/conta/perfil` e
`/painel` anônimos devolviam **200 com o perfil de gosto do DONO** — o resumo em prosa, as tags, a
versão, o alinhamento — com "Entrar" na barra ao lado. Sem sessão, `getCurrentUserId()` cai no
singleton **por design** (o recalc em background precisa do bias dele), então a página tinha um
sujeito: o errado.

⚠️ **Não dá pra corrigir só trocando o leitor por `getSessionUserId()`** — sem sessão a página não
tem sujeito nenhum. Mas gate de rota também não basta sozinho: `getTasteProfileStatusAction` é
consumida por **três** páginas (`/painel`, `/recommendations`, `/conta/perfil`), então ela devolve
um `ProfileStatus` vazio sem sessão e repassa o `userId` adiante. Rota + fonte, as duas.
Guardadas por `tests/unit/orchestration/rotas-de-sessao.test.ts` (que **deriva** os diretórios de
`SIGNED_IN_PREFIXES` — a 1ª versão tinha `app/conta` fixo, e foi assim que o `/painel` passou
enquanto o `/conta` era corrigido) e por `leitores-por-sessao.test.ts`.

🔴 **Gate de rota NÃO funciona só no layout.** A 1ª versão fazia `notFound()` no layout da console e
o Next devolvia **200 com o HTML da página protegida no corpo**, seguido do 404: layout e página
renderizam em PARALELO, então o `notFound()` chega depois de o stream ter começado. O proxy roda
antes de qualquer renderização — é o único ponto onde a decisão cabe. O `notFound()` do layout ficou
como 2ª linha (matcher pode mudar; e o proxy é fail-OPEN quando o usuário está logado mas não tem
linha em `user_settings`, caso que só `isCurrentUserAdmin()` resolve, pois precisa da service role).

**A home (`/`) é uma VITRINE, e bifurca por sessão.** Não é mais o painel de KPIs — esse virou
`/painel` ([[project-painel-provisorio]], provisório de propósito).

- **Com sessão:** destaque "Continue lendo" escolhido pela banda **Acompanhando** da `/leitura`
  (`lib/reading/pace-bands.ts`, ≥85% lido + leitura recente, desempate por capítulo mais novo),
  faixa de atividade e prateleira "Pra você hoje". ⚠️ `getContinueReading` ordena por última
  LEITURA e corta no limite **antes** de qualquer seleção — pedir poucos itens esconde do
  destaque a obra que acabou de receber capítulo (foi bug real).
- **Sem sessão:** `components/home/public-home.tsx` — raio-X dos 9 critérios de uma obra,
  prateleira por `platform_avg` (com piso de votos), rodapé pra `/sobre` e `/guia`. Nada
  pessoal: sem sessão os leitores per-usuário devolvem vazio, e o que existia ali antes eram os
  dados do dono.

⚠️ **Rótulo depende da publicação:** "quase no fim" só vale pra obra concluída; em `Ongoing` a
mesma banda quer dizer "quase em dia" (você está alcançando os lançamentos, não terminando).

**A navegação é uma BARRA SUPERIOR** (`components/layout/top-nav.tsx`), desde 2026-08-02 — a
sidebar de 13 itens foi removida. A régua original ("o topo é sobre obras, o avatar é sobre você")
**quebrava no primeiro item** — "Minha lista" era sobre VOCÊ e morava no topo — e foi trocada em
2026-08-07 por uma régua de **pergunta**, não de assunto:

| Zona | Pergunta | O que entra |
|---|---|---|
| Esquerda | "pra onde eu vou?" | destinos, máx. 5, **todos planos** — sem dropdown |
| Centro | "onde está aquilo?" | a busca (⌘K), elástica 190–460px |
| Direita | "o que está acontecendo?" | só o que tem **número ou estado** |
| Avatar | "coisas minhas" | conta, preferências, importar, painel, **a fila de recomendação** |

Hoje: `Acompanhamento · Favoritos · Catálogo · Ranking · Recomendações`, com **o logo fazendo o
papel de Início** (`aria-current` + estado ativo). Saíram: "Minha lista ▾" (enterrava os destinos
nº 1 e nº 2 um clique abaixo), "Explorar ▾" (menu de UM item) e o relógio da fila (que duplicava
um item que já estava dentro do menu).

⚠️ **Destino que não funciona pra quem está vendo não ocupa vaga.** `/recommendations` é per-user
do topo ao rodapé e `/ranking` ordena pela Nota Prevista com presets de alguém — então os dois
exigem `requiresSignedIn`, no topo **e** na bottom-nav. Ao visitante sobra Catálogo + busca +
"Entrar". Guardado por `tests/unit/orchestration/top-nav-regua.test.ts`.

🔴 **A regra "ícone e não item de menu, porque dentro de dropdown o número não é visto" continua
verdadeira** — o que mudou é que agora o **contador vive no gatilho**. Foi isso que permitiu
recolher fila de curadoria + saldo + alerta de fontes no `CurationMenu` (badge = curadoria +
pedidos, ponto âmbar para saldo/fonte) e a fila de recomendação no avatar. **Se o badge sair, os
ícones soltos têm que voltar.** Guardado por `tests/unit/ui/chrome-counters-on-trigger.test.tsx`
— e é teste de RENDER de propósito: a primeira versão varria o source atrás de `recQueue > 0` e
passava com o badge desligado, satisfeita pela mesma expressão no `title` do botão.

⚠️ **Curadoria é MODO, não ação pontual — e por isso o `CurationMenu` deixou de ser menu**
(2026-08-07). Hoje é um **botão-link** pra `/curadoria`: badge + ponto colorido, sem dropdown.
Três coisas convergiram:

1. **A régua da própria barra o contradizia.** A zona direita responde "o que está acontecendo?"
   — *só o que tem número ou estado*. Seis links de navegação são a pergunta da zona ESQUERDA.
   O badge pertencia ali; os destinos, não. Eles entraram de carona quando o menu foi criado
   pra consolidar três SINAIS (fila, saldo, saúde de fonte).
2. **O curador também é leitor, e os dois focos não se intercalam.** Ninguém "gerencia um pouco
   enquanto procura o que ler". Oferecer atalhos pra dentro da console a partir de qualquer tela
   comunicava o contrário e enfraquecia a console, que já é o lugar.
3. **A conta de cliques nunca sustentou o menu**: 2 cliques em 5 dos 6 destinos, igual ao
   botão-link — o dropdown só ganhava na Visão geral, o destino menos visitado.

🔴 **O que mudou de verdade é onde os SINAIS moram.** Saldo e saúde de fonte desceram pra
`/curadoria`; na barra ficou só o ponto colorido dizendo "algo lá precisa de você". Isso torna a
Visão geral **obrigada a explicar o badge inteiro** — ela é a única superfície de triagem que
sobrou. Duas consequências que se pagam caro se forem esquecidas:

- As parcelas do badge saem de **`lib/curadoria/decision-queues.ts`**, iterada pelos DOIS lados
  (soma do gatilho e `buildDecisions` da página). Enumerar de novo é como os **Pedidos entraram
  no badge e nunca chegaram na página** — um "3" no botão que podia ser 3 pedidos de leitor, com
  a página que devia explicá-lo sem mencionar nenhum. O tipo `Record<DecisionQueueKey, number>`
  faz o `tsc` reprovar os dois consumidores quando uma fila nova aparece (medido).
- O limiar de saldo baixo é **`lib/ai-usage/balance.ts`** (`LOW_BALANCE_USD` + `balanceTone`).
  Estava copiado em dois arquivos; uma terceira cópia é como o ponto alerta e a página pra onde
  ele aponta mostra verde. ⚠️ Os tons são **exclusivos**: saldo negativo NÃO é `"low"` — use
  `balanceAlerting()`, senão o ponto some no pior caso.

⚠️ **Aberto, não esquecido:** abaixo de `xl` o botão é só o ícone 🔧 sem rótulo. Porta fraca pra
um modo de primeira classe — mas dar rótulo permanente reabre a conta de largura (ver a ordem do
sacrifício abaixo).

⚠️ **A ordem do sacrifício.** Quando a barra não cabe, cede nesta ordem: rótulo do "Recalcular
notas" → nome no avatar → rótulo de "Curadoria" → a busca vira ícone. **Os destinos e os
contadores nunca cedem** — por isso a nav é `shrink-0` e quem encolhe é a busca. Na 1ª versão era
o contrário e o texto do link transbordava por cima do vizinho, sem nada acusar. Medido em 14
combinações papel × largura: o pior caso (Curador em 980px com recalc + tarefa + saldo baixo +
Comix instável) fecha em 968 de 978px.

⚠️ **Ação lenta na barra tem dono:** o chip e a faixa de tarefas em segundo plano vivem no
`top-nav.tsx` e são desenhados por `components/tasks/top-nav-tasks.tsx`. Ver a seção
**"Ação lenta tem DUAS cores"** — inclusive por que `components/tasks/sidebar-tasks.tsx` foi
apagado (ficou órfão quando a sidebar saiu, e o feedback sumiu sem nada acusar).

**A console `/curadoria`** (`components/curadoria/console-shell.tsx`) é o terceiro braço dessa régua,
desde 2026-08-03 — o 🛠 da barra aponta pra ela. Sidebar PRÓPRIA de dois níveis com Visão geral ·
Curadoria da Obra · Configurações (+ os 4 tópicos) · Uso da API IA · Métricas do modelo. Cada rota
membro entra por um `layout.tsx` de 3 linhas que renderiza a shell — o gate e a sidebar vêm dela.

- ⚠️ **`/settings` PERDEU a `SettingsSubnav`**: os 4 tópicos viraram o ramo "Configurações" da
  sidebar da console. Continuam sendo `?g=` na mesma rota (nenhum deep-link quebrou, inclusive o
  `/settings?g=fontes` do alerta do Comix). `SettingsSubnav` segue viva, para `/preferencias`.
- ⚠️ **"Desatualizados" ficou de FORA**, apesar de constar no plano: virou aba de
  `/fila-recomendacao` e é de qualquer logado. Item de console que joga o usuário pra fora da
  console é pior do que item ausente. `/ranking/desatualizados` segue como redirect.
- Os contadores da sidebar e os da barra superior saem de **um fetch só**
  (`components/layout/chrome-badges.tsx`, no layout raiz). O coalescing do `useChromeData` é por
  instância — um hook em cada consumidor duplicaria `getSettingsItemPending` (que puxa LINHAS, não
  `count: exact`) e o gatilho do auto-recalc.

**Toda rota é dinâmica (`ƒ`) — e agora POR ESCRITO.** `app/layout.tsx` declara
`export const dynamic = "force-dynamic"`. 🔴 **Não remova sem substituir por outra garantia.**

Motivo: o app é inteiramente per-user, e uma rota prerenderizada congela no HTML do build o que
era verdade pra quem (ou ninguém) estava logado naquele instante — e serve isso pra todo mundo,
**sem erro e sem log**. É a mesma classe do "anônimo vira dono" ([[gotcha-anonimo-vira-dono]]),
por outro mecanismo.

Até 2026-08-02 essa garantia existia **por acidente**: o layout lia `cookies()` pro colapso da
sidebar, e isso bastava pra marcar tudo como dinâmico. Quando a sidebar virou barra superior o
`cookies()` saiu junto e a rede caiu — nada apontava pra ela. Daí a linha explícita.

O preço: as institucionais (`/sobre`, `/guia`, `/login`, `/signup`) perdem prerender. Pra liberar
essas, **meça**: `next build`, ler a tabela `ƒ`/`○`, marcar rota a rota. Nunca apagar a linha e
torcer. ⚠️ Um grep por `cookies()` **não** responde quem é dinâmica: a detecção do Next é
transitiva (`/favorites` não cita `cookies()`, mas chama `getPersonalStateReader` →
`getSessionUserId` → `cookies()`).

`lib/sidebar-preference.ts` segue no repo como documentação do padrão cookie-vs-localStorage, sem
uso funcional.

```
app/              – Next.js routes (server components by default)
components/       – React components ("use client" where needed)
server/
  actions/        – "use server" functions called directly from client components
  queries/        – server-only DB read helpers (no "use server" directive)
lib/
  ai-evaluation/  – Claude API integration (service.ts)
  calculations/   – deterministic scoring pipeline
  constants/      – GENERATED files (do not edit by hand)
  external/       – third-party API integrations + multi-source merge logic
  format/         – formatação de valor pra tela (money.ts é o dono único de USD)
  import/         – GENERATED files + CSV/XLSX import pipeline
  ml/             – Ridge regression for Nota Prevista / expected_score (pure TS, no native deps)
  supabase/       – client factories
  validations/    – Zod schemas
types/domain.ts   – canonical domain types (partly GENERATED)
scripts/sync-constants.js – DB → TypeScript code generator
supabase/migrations/ – SQL migration history
```

## Ação lenta tem DUAS cores, e elas dizem coisas opostas

Toda ação que demora precisa dizer que está viva. Qual indicador usar depende de **uma
pergunta só: o resultado sobrevive se a pessoa sair da tela?**

| | **Azul — durável** | **Âmbar — request-scoped** |
|---|---|---|
| Critério | grava no banco enquanto roda | o resultado só existe na tela |
| Onde mora | barra superior (segue a navegação) | dentro do diálogo/painel que disparou |
| Promessa | "pode navegar, te aviso ao terminar" | "fique aqui, senão perde" |
| Código | `lib/tasks-store.ts` + `components/tasks/top-nav-tasks.tsx` | `components/tasks/scoped-task.tsx` |

Trocar as duas é um erro **silencioso e caro**: pôr uma ação scoped no azul é convidar a
pessoa a navegar e jogar fora o trabalho dela; pôr uma durável no âmbar prende alguém numa
tela por 33s à toa. **Não deduza pelo nome da action** — confira se ela escreve:
`grep -E 'insert|upsert|update\(' ` no corpo dela. Foi assim que `proposeFavoriteGroups`,
`suggestScoreWeights` e `suggestPostReadingWeights` mudaram de lado: parecem duráveis, só leem.

### Azul: `runTask` (`lib/tasks-store.ts`)

Store de MÓDULO (não estado de componente), então sobrevive à navegação client-side: o store
DONA a promise, e o toast de conclusão + `refreshChrome()` rodam mesmo com a página que
disparou já desmontada. Desenho no chrome: faixa indeterminada na borda de baixo do
`<header sticky>` (periférica, segue o scroll) + chip com contador que abre o `TaskCard`
sozinho por ~4,5s ao começar — o instante em que o olho ainda está no botão clicado.

🔴 **As server actions daqui devolvem `{ error }` em vez de LANÇAR**, e o `runTask` só
distingue falha por rejeição da promise. Sem `throw new Error(res.error)` dentro do `run`, o
indicador anuncia **"pronto" para uma falha** — plausível, errado, sem log. (`refreshEmbeddings`
é a exceção: essa lança.) Guardado por `tests/unit/ui/rerank-task-error.test.tsx`.

⚠️ **`successToast: () => null` quando o desfecho tem mais de um tom.** Embeddings (nada a
fazer / parcial / ok) e aplicação de clusters de tags (`errors[]` = sucesso PARCIAL) seriam
achatados em "success" pelo toast padrão, e o caso de falha sumiria.

⚠️ **Lote usa `setTaskProgress(id, done, total)`** → barra determinada + "3/12" no card. O
`runTask` não conta sozinho; quem itera avisa. A função é no-op se a tarefa não está mais
`running`, senão o laço do caller ressuscita tarefa já dispensada.

### Âmbar: `useScopedGuard` + `ScopedTaskStrip` (`components/tasks/scoped-task.tsx`)

🔴 **A porta de saída depende de a ação morar num modal ou solta na página, e isso não é
intuitivo.** `Dialog`/`Sheet` do Radix são **modais**: o scrim já bloqueia clique fora, então
o link da barra nem é alcançável — a porta real é **fechar o diálogo**. Só ação solta numa
página usa `guardNavigation: true` (interceptação de clique em fase de captura). Ligar
`guardNavigation` numa modal cria um interceptador global que nunca dispara: código morto com
cara de proteção. Guardado por `tests/unit/orchestration/scoped-guard-placement.test.ts`.

⚠️ **Fechar por fora do `onOpenChange` escapa da trava.** O X do `WorkCompareDrawer` chamava
`onOpenChange(false)` direto — todo caminho de fechamento tem que passar pelo `guard`.

🔴 **Voltar/avançar do browser NÃO é coberto** — limitação aceita, não esquecimento. Cobrir
exigiria empurrar entrada falsa no histórico e interceptar `popstate`, o que quebra o botão de
voltar para o app inteiro. `beforeunload` cobre fechar/recarregar a aba; o botão de voltar sai
direto e perde o resultado.

⚠️ **O cronômetro conta TICKS, não `Date.now() - início`**: o lint (`react-hooks/purity`)
barra `Date.now()` no render. O preço é subcontar com a aba em segundo plano — aceitável,
porque a faixa âmbar existe justamente para quem está olhando a tela.

⚠️ **Cronômetro e não barra determinada**: nessas ações não dá pra saber quantas fontes vão
responder, e progresso inventado mente pior do que progresso nenhum.

### Cobertura atual

**Azul (durável):** avaliar IA · recomendar (e por grupo) · digest · gerar tudo · buscar
reviews · inferir tags · regerar sinopse · perfil de gosto · re-rank (obra, lote, cluster,
re-rodar run) · Interesse em lote · deep dive · auditoria de calibração · relatório de viés ·
regenerar artefatos calibrados · embeddings · aplicar clusters e grupos de tags ·
enriquecimento em lote do `/import`.

**Âmbar (scoped):** "Buscar dados" · "Atualizar dados" · desempate de cluster · sugerir grupos
de favoritos · sugerir pesos (IA e pós-leitura).

**Fora dos dois, de propósito:** recalc (tem `RecalcPendingControl` próprio na barra) · chat de
recomendação (UI própria) · resolvedor Comix (job com painel de polling).

🔴 **Pendências conhecidas, não escondidas:**
1. **Reload zera o indicador azul** (store em memória). A ação continua e persiste; só o
   desenho some. Reconstruir pede ler `ai_evaluations.status='processing'` no load.
2. **Previsão de Interesse POR OBRA continua sem indicador.** `predictInterestWithToast` tem
   confirmação de custo **recursiva** (a 1ª chamada volta `blocked_cost_confirmation`, abre
   modal e re-chama a si mesma); uma tarefa em volta disso diria "rodando" enquanto um modal
   espera clique. Precisa do helper refatorado antes. O LOTE já está ligado.
3. **Latências medidas** (`ai_api_calls.latency_ms`, p50): perfil de gosto **33,4s** ·
   ranking **14,0s** (p90 47,9s) · digest 13,4s · avaliação IA 17,5s · tags 7,6s · Interesse
   4,9s. Deep dive **sem medição** (zero linhas locais).

## A query string do /ranking é um CONTRATO — e ela fala PONTOS

Os limiares dos 9 atributos (`min_<slug>`/`max_<slug>`) estão **sempre em pontos (0–10)** na
URL. O `/ranking` tem uma unidade **σ** (`?crit_unit=sd`), mas ela é **lente de exibição**: a
UI converte na hora de mostrar e de gravar, e a URL nunca carrega σ.

Não é estilo — é o que mantém correto todo mundo que lê essa mesma query string **sem saber
que σ existe**: `getRanking`, os presets salvos (`ranking_filter_presets` guarda a query
CRUA), o `/favorites` e o `parseFiltersFromSearchParams` do diálogo de recomendação. Numa
primeira versão a URL carregava σ, e `min_romance=-0.5` chegava na recomendação como
"romance ≥ −0,5 **pontos**" — filtro nenhum, sem erro, com resultado plausível.

Corolário de graça: trocar de unidade não reescreve valor, então **nunca muda o resultado**.
Guardado por `tests/unit/orchestration/criterion-unit-url-invariant.test.ts`.

⚠️ **Em eixo normalizado (σ, percentil, log), nada pode ser constante.** Quatro bugs da mesma
família saíram desta feature, todos silenciosos e todos produzindo resultado plausível:
arredondar pro mais próximo em vez de direcional (−54 obras), limiar fora da grade de 0,5 em
que as notas existem (−421 obras), σ na URL lido como pontos por outro consumidor, e domínio
de slider FIXO em vez de derivado dos momentos — este apagava o filtro do usuário, porque o
Radix clampava o valor fora do domínio e o `commit` gravava `null`. Ver
`lib/ranking/criterion-unit.ts`, onde cada um está documentado com o número medido.

## Quem ordena, colore ou agrupa por nota tem que ver o MESMO número da tela

Três invariantes do `/ranking`, todas descobertas pelo mesmo sintoma — resultado plausível na
posição errada, sem erro nem log (2026-08-06):

**1. Arredondamento.** A tela usa `value.toFixed(1)`; o atalho `Math.round(value * 10) / 10`
**não é equivalente** e diverge em **40 dos 1.001 valores de 2 casas** entre 0 e 10 — `value * 10`
é uma multiplicação em ponto flutuante que arredonda ANTES do `Math.round`. Medido: a obra de
`expected_score` 8,35 ordenava como 8,4 e **exibia 8,3**, aparecendo à frente de dois 8,4
legítimos. Use `roundToDisplayScore` (`lib/score-rounding.ts`) em ordenação, faixa de cor,
empate e limiar. Ingestão de dado externo pode seguir com `Math.round` — lá não há número na
tela pra concordar.

**2. A chave da BANDA é a da ORDENAÇÃO.** `buildRankingTiers` devolve alinhado à entrada e quem
consome agrupa RUNS CONSECUTIVOS: bandar pela nota crua uma lista ordenada pela nota exibida faz
o mesmo tier reaparecer várias vezes. Medido: **2 tiers reais viravam 8 blocos "Tier N"** nas 40
primeiras obras (3 → 27 em 200), e na view Faixas ainda duplicava a React key `band-${tier}`.

**3. O tier AGRUPA, não reordena.** Havia um `reorderTiersByFit` no cliente que reordenava cada
tier por `tagOverlapNet` por cima da ordem do servidor, com a premissa falsa de que "dentro do
tier tudo empata" (banda 0,5 cobre 8,5 → 8,0). Ele descartava o 2º nível de ordenação escolhido
**e** a Nota Prevista — a lista saía `8,7 → 8,8 → 8,9 → 9,1 → 8,8 …`. O sinal virou o desempate
FINAL do `getRanking` (depois de todos os níveis, antes do título), então decide só o que
ninguém mais decidiu e vale igual em Lista, Cards, Faixas e Bússola.

Guardadas por `tests/unit/ranking/score-rounding.test.ts` e `build-tiers.test.ts`.

## Na Bússola, EMPATE é regra — e ponto empilhado imita o estado aceso

`computeWorkForces` **arredonda pra inteiro** antes de virar posição (`round(chance_score)`,
`round(platform_avg × 10)`), e a posição é o percentil com midrank. Logo, valores diferentes
viram a **mesma coordenada**: medido em 2026-08-08 nas 40 obras do topo, **dois pares** caem no
mesmo pixel (ex.: chance 56,04 e 56,32 → 56, com nota 8,1061 e 8,0987 → 81).

Isso produzia dois bugs de uma vez, os dois silenciosos:

1. Os dois pontos desenhavam um **anel** — porque o de cima tem `border-background` — e o anel
   era **idêntico ao estado aceso**. Foi lido como estado por quem usa e por quem mantém.
2. Quando o MAIOR era pintado por último, ele cobria o menor inteiro: obra **invisível e sem
   hover**, presente só na lista lateral.

Três defesas, em `components/ranking/bussola-plane.tsx`:

| Defesa | O que garante |
|---|---|
| `spreadTies` | empatados se afastam num círculo — **≤40% de um passo de percentil** e **nunca cruzam a mediana** (a cor vem do quadrante; cor e posição não podem discordar) |
| `byDrawOrder` | pinta do maior pro menor, então ponto pequeno nunca some |
| aceso com anel **neutro** (`--foreground`) | sobreposição de pontos não consegue imitar |

🔴 **`boxShadow` inline VENCE a classe do Tailwind** — o `focus-visible:ring-2` do ponto nunca
chegou a aparecer, era proteção de mentira. Quem marca o foco é o próprio aceso (`onFocus`
acende o ponto), e por isso o `lit` também é passado no modo absoluto.

⚠️ **O tooltip é a lupa: mostra o CRU** (nota externa 8,1 e 1.278 votos), porque "81" e "66" são
as forças normalizadas — não são nota nem votos. A Nota Prevista abre o card com
`getScoreTextColor` e as faixas de `/preferencias` (`scoreThresholds.expected`, passada pelos
dois consumidores); sem elas caem os cutoffs fixos do `ScoreBadge`. **Cor própria aqui seria uma
2ª régua pro mesmo número.** O bloco da nota é `float`, não item de flex: ao lado, ele encolhia
TODAS as linhas do título (46 caracteres viravam 4 linhas num card de 268px; hoje 320px + float
= 2 linhas).

Guardado por `tests/unit/ranking/bussola-empilhamento.test.tsx` e `bussola-legenda-lista.test.tsx`
— inclusive um teste que falha se a prop de faixas for ignorada, que era o jeito silencioso de a
cor da nota regredir pro fallback.

## Dado gerado por IA carrega um SELO — e nenhuma procedência fica solta na tela

Todo bloco da página da obra cujo conteúdo saiu de um modelo leva o selo ✨
(`components/ui/ai-provenance.tsx`), e modelo/prompt/data/confiança vivem **só** no tooltip
dele. Régua de 2026-08-08, em 11 superfícies: Resumo da avaliação IA · Notas por critério ·
Sinopse consolidada · Interesse previsto · Síntese das reviews (+ resumo em prosa) · Veredito
IA · Deep Dive · Tags inferidas · Atributos da obra. O ℹ️ de "Obras parecidas" ganhou o modelo
do embedding no tooltip que **já** explicava o método — busca vetorial não é texto de LLM, e
dar a ela a mesma marca da sinopse afirmaria algo falso.

Dois problemas que a ausência da régua produzia:

1. **Duplicação.** "Resumo da avaliação IA" e "Notas por critério" imprimiam a MESMA faixa
   (`Modelo · Confiança · Reviews · Data`) da MESMA avaliação, escrita em dois lugares. Hoje um
   objeto só (`aiEvalProvenance`) alimenta os dois selos.
2. **Omissão.** A sinopse canônica é ESCRITA por um modelo e a página não dizia isso em lugar
   nenhum. Por isso o selo é a **marca**, não só o botão: ele aparece mesmo com o modelo
   desconhecido ("sem registro"). Escondê-lo apagaria o fato de o texto ser de IA.

🔴 **O que NÃO vai pro selo: ESTADO.** "Desatualizada" (Interesse) e "Desatualizado" (Veredito)
ficam na tela. Não são procedência — são o que impede aplicar ao pipeline de notas um número
que a IA já não sustenta. Enterrá-los num tooltip devolve o "aplicar cego".

⚠️ **Fora da régua, de propósito:** Nota Prevista, Nota.Calc, Alinhamento e a Bússola são Ridge
e aritmética em TS, sem LLM — selo "gerado por IA" ali seria mentira. A caixa lateral
("Última avaliação em / Atualizada em") também fica: é painel de FRESCOR da ficha, e
"Atualizada em" nem é de IA.

🔴 **Modelo não existe pra todo mundo, e o número é medido.** Sinopse, síntese/resumo de reviews
e tags não têm coluna de modelo; o que existe é o log central (`ai_api_calls`, ligado por
`metadata->>'work_id'`), e ele **só começa em 03/07/2026**. Medido em 2026-08-08 no clone local:

| Artefato | tem o artefato | modelo recuperável |
|---|---|---|
| sinopse consolidada | 980 obras | 327 (**33%**) |
| síntese das reviews | 841 | 487 (58%) |
| resumo em prosa | 885 | 498 (56%) |
| Veredito IA (via `alignment_run_id`) | 501 | 66 (**13%**) |
| tags inferidas | 475 | **0** — nenhuma chamada grava `work_id` |

Não fixe o modelo numa constante: `synopsis_consolidator` e `review_digest` têm **2 modelos
distintos** no histórico, então "Sonnet" mentiria em toda obra antiga, em silêncio.

⚠️ **Dentro do tooltip, tom secundário é `text-background/<alfa>` — nunca token de página.**
O `TooltipContent` é invertido (`bg-foreground` + `text-background`). `text-foreground` ali é
invisível nos dois temas (bug de 2026-07-03); `text-muted-foreground` é pior de achar: passa no
escuro e cai pra ~3:1 no CLARO (medido). Guardado por `tests/unit/ui/ai-provenance-selo.test.tsx`,
que lê o ARQUIVO — a 1ª versão varria `AiProvenanceSeal.toString()` e não enxergava
`ProvenanceRow`, que é justamente quem desenha o corpo.

## No card de reviews, o organizador é o EIXO — e o texto longo mora fora do corpo

`components/titles/work-reviews-card.tsx` + `lib/reviews/digest-view.ts` (2026-08-09). O card
agrupava os traços por POLARIDADE (Elogios/Ressalvas/Críticas), que responde "a internet
gostou?" — pergunta que `platform_avg` já responde melhor. Quem responde "ela é boa **no que me
importa**?" é o `axis` de cada traço, e ele **existia no dado e vivia só no `title=` do chip**.

Medido no clone local (841 obras com digest, 6.178 traços):

| O quê | Número |
|---|---|
| eixos distintos por obra | **6** em 8 traços (mediana) — quase todo chip falava de outro assunto |
| tamanho do "chip" | **64 caracteres** de média (p90 87, máx 157) — é frase, não chip |
| vocabulário de eixos | 8 valores cobrem **99,1%**; a cauda são 55 ocorrências |
| sínteses feitas com <10 reviews | **206 obras (24,5%)**, 26 delas com ≤3 |
| reviews com nota | **17,9%**; só **291 de 882** obras têm ≥5 |

Quatro invariantes que se pagam caro se forem esquecidas:

- 🔴 **O texto do traço NÃO vai na linha da régua.** Ele mora no painel ao lado, num espaço
  **já reservado** — é isso que mantém a altura do card estável ao trocar de eixo (medido:
  873px → 873px). Inline, cada clique empurra a régua e o card pula.
- ⚠️ **Eixo desconhecido não é remapeado.** `normalizeAxis` só normaliza caixa e corta no
  primeiro segmento antes da barra; forçar "roteiro → escrita" mentiria sobre o que a review
  disse. Os limiares do sinal (`reviewSignal`) e o mínimo do histograma
  (`MIN_RATINGS_FOR_HISTOGRAM`) também moram lá — uma 2ª cópia é como a barrinha diz "forte"
  e o popover explica um critério diferente.
- ⚠️ **Intensidade ≠ contagem.** Os glifos repetidos (`▼▼`) contam o tom DOMINANTE; a pílula
  conta todos os traços do eixo. Moralidade com 1 negativo + 1 misto é "▼ criticado" com
  contador 2 — juntar os dois faz "▼▼" aparecer onde há uma crítica só.
- 🔴 **`flex-1` + `height:%` = gráfico invisível.** Ao tentar esticar o histograma para ocupar
  o vão da coluna, as barras sumiram nos dois temas: porcentagem precisa de altura
  **resolvida** no pai, e `min-h-*` não serve de base. Altura fixa (`h-14`) é o que funciona.

⚠️ **Container query mede o CARD, não a página.** A página da obra é `max-w-6xl` (1152px), mas
o card mede **868px** ali dentro — `@4xl` (896px) nunca disparava e as duas colunas viravam
pilha, em silêncio. Meça no app antes de escolher o breakpoint. E o rodapé é **irmão** do
`CardContent`: sem `@container` próprio, as classes `@2xl:` dele eram letra morta.

Guardado por `tests/unit/reviews/digest-view.test.ts` e `tests/unit/work-reviews-card.test.tsx`
— este último é teste de RENDER de propósito: um teste que lesse o objeto do digest passaria
verde com o eixo fora da tela, que era exatamente o estado anterior.

## Dinheiro tem UM dono, e a unidade muda com a escala

Todo valor em USD na interface passa por **`lib/format/money.ts`** — `formatUsd`,
`formatUsdApprox` (estimativa, com "~") e `makeUsdScale` (régua compartilhada). A régua:
**abaixo de 10¢ o valor sai em centavos** (máx. 2 casas, sem zeros mudos: `5,67¢`, `0,2¢`),
**de 10¢ pra cima em dólares** (`$0,13`, `$38,50`), sempre em **vírgula pt-BR**.

O corte é 10¢ e não US$1 porque é ali que o dólar **colapsa**: a maioria das chamadas de IA custa
entre US$0,0001 e US$0,09, e com 2 casas isso vira "$0.00". Acima de 10¢ o inverso vale — `$0,57`
lê melhor que `57,3¢`.

⚠️ **Isso não é cosmético — o formato antigo apagava diferença real.** Medido em 2026-08-07 na
coluna "custo por chamada" do `/ai-usage`: `tag_classifier` (0,57¢), `tag_inference` (1,09¢) e
`synopsis_quality_predict` (1,27¢) exibiam **todas o mesmo "$0.01"** — custos 2,2× distintos com
o mesmo rótulo, sem erro e sem log.

🔴 **A duplicação é o modo de falha, não a fórmula.** Até 2026-08-07, **seis arquivos** formatavam
dinheiro por conta própria (oito funções, duas convenções incompatíveis):
`components/settings/ai-usage/format.ts` (ponto), **três cópias literais** dela (card de saldo, os
dois gráficos), a de 4 casas do badge dev, e a dupla `formatUsd`/`formatUsdExact` de
`lib/cost-preview/catalog.ts` (vírgula) — além de ~12 `toFixed()` soltos em toasts e mensagens de
servidor. O sintoma era visível: o `/ai-usage` mostrava `$0.06` e o popup de custo mostrava
`~$0,05` na mesma sessão. É a mesma armadilha do `LOW_BALANCE_USD`; uma 7ª cópia é como duas telas
voltam a discordar sobre o mesmo número.

🔴 **Valor que aparece ao lado de outro usa `makeUsdScale`, nunca `formatUsd` um a um.** Toda
comparação lado a lado é uma **régua** e precisa de uma unidade só: eixo de gráfico, par
estimativa/teto, gasto contra cap, e a lista inteira quando ela existe pra ordenar as opções.

⚠️ **"Régua" é mais largo que "eixo", e foi assim que as duas primeiras versões erraram.** A 1ª só
cobria eixo, e a lista "Quanto custa cada ação" saiu com `~8,15¢` ao lado de `até $0,12` **na mesma
linha**. A 2ª esqueceu **coluna de tabela** — em "Por operação" a coluna Custo tinha `$0,33` e
`0,46¢` (o "0,46" lê como MAIOR, sendo 70× menor), e a coluna Custo/sucesso tinha `$0,30` e `0,3¢`,
dois "0,3" que diferem 100×. **Coluna ordenável é o pior caso**: a mistura inverte a leitura de quem
é maior. A 3ª esqueceu a **quebra que SOMA um total** — o badge de custo por obra imprimia `$0,13`
sobre `5,37¢ · 3,98¢ · 1,53¢ · 1,14¢ · 0,50¢`, e a conta parava de fechar de olho.

**Hoje são 15 réguas** — conferido, **não** contado de cabeça. Esta linha já dizia "12" quando eram
13, porque a coluna "Custo USD" da tabela **Por modelo** (`app/ai-usage/page.tsx`) nunca entrou na
conta. Antes de mexer neste número, rode:

```bash
grep -rn 'makeUsdScale(' --include='*.ts' --include='*.tsx' . \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'lib/format/money.ts' | grep -v '^\.\?/\?tests/'   # → 15 em 2026-08-08
```

Contagem que fecha com ele:

| Quantas | Onde |
|---|---|
| 2 | gráficos (diário, por operação) |
| **4** | colunas de tabela — Custo do log de chamadas, Custo e Custo/sucesso de "Por operação", **Custo USD de "Por modelo"** |
| 1 | a lista "Quanto custa cada ação" (`cost-menu`) |
| 1 | o bloco de custo (`cost-summary`) |
| 1 | os botões do confirm (`cost-confirm`) |
| 1 | o toast do backfill de Interesse |
| 3 | mensagens de bloqueio por teto (`synopsis-quality`, `interest-ui`, `interest-backfill`) |
| 1 | o badge dev de custo por obra |
| 1 | o card de saldo |

⚠️ **Elemento recorrente cuja distribuição senta EM CIMA do corte precisa de régua própria** — senão
ele troca de unidade a cada navegação e inverte a leitura sem nada acusar. Medido em 2026-08-08 no
badge dev de custo por obra: das **520 obras** com custo atribuído a mediana é **US$0,079 (7,9¢)**,
a dois centavos do corte de 10¢ — 338 em ¢ e 182 em $. A saída não foi fixar centavos no código:
`components/titles/dev-work-ai-cost.tsx` monta **uma régua** com o total, todas as parcelas e o
baseline, e o número do **gatilho** sai dela. Como toda parcela é pequena, isso dá ¢ pra qualquer
obra de hoje (máx. 58,2¢) e volta pra $ sozinho no dia em que uma passar de US$1. Mesma correção em
`balance-card.tsx`: informado − gasto = restante são termos de uma conta só.

⚠️ **Régua de coluna sai das linhas VISÍVEIS**, não do conjunto todo — filtrar por modelo no log de
chamadas muda o que está sendo comparado, e a unidade tem que acompanhar.

⚠️ **A unidade sai do MENOR valor não-nulo, não do maior** — é o menor que colapsa em `$0.00`,
então é ele quem decide se a régua precisa de centavos. O maior só exerce **veto**: a partir de
US$1 a régua inteira vai pra dólar, senão um eixo de US$0,001 a US$7,76 imprimiria `776¢`. Zero
não opina (num eixo ele é sempre o 1º tick, e fixaria tudo em centavos).

🔴 **Sob veto, o menor da série NÃO pode virar `$0,00`** — isso afirma que não houve custo. Medido:
`suggest_groups` custou US$0,0046 e o veto do US$25,91 da mesma coluna puxou a régua pra dólar. Por
isso `asDollars` tem o mesmo `<$0,01` que `asCents` já tinha; zero de verdade segue `$0,00`.

⚠️ **Quem embute o `CostSummary` numa tela que também mostra dinheiro tem que PASSAR a régua**
(`scale`). Derivar uma de cada lado não basta: o card conhece o custo por item e os passos da
cascata, o rodapé conhece a ação secundária — mesmas entradas aparentes, réguas diferentes.

**Fora daqui, de propósito:** `scripts/*.ts` — é saída de terminal pro dev, e mudar o formato
quebraria a comparação com logs de execuções antigas.

Guardado por `tests/unit/format/money.test.ts` (10 casos, inclusive saldo negativo — que antes
saía `$-4.20`, com o cifrão na frente do sinal) e por
`tests/unit/format/dev-work-cost-regua.test.tsx` — este último é teste de **render**, de propósito:
o `money.test.ts` passava verde enquanto o badge chamava `formatUsd` quatro vezes em separado. O
que regride nesta classe não é a fórmula, é o **escopo**, e escopo só aparece na árvore desenhada.

## O painel de filtros é RASCUNHO — navegar por fora dele apaga o filtro

`RankingFilters` (usado por `/ranking` **e** `/favorites`) escreve tudo em `draftSearch` e só o
"Aplicar filtros" navega. 🔴 **Qualquer coisa que mude a URL sem passar pelo rascunho é apagada
no Aplicar seguinte**, porque ele reescreve a query string inteira a partir de uma foto que não
conhece aquela mudança — sem erro, com cara de "não aplicou".

Foi assim com o segmentado "Esconder tags evitadas", o único controle feito de `<Link href>`.
Hoje ele é rascunho como os demais, e o rascunho **adota a URL** quando ela muda por fora
(ajuste durante o render, com `lastApplied` em STATE — ler `ref.current` no render é proibido
pelo lint do React). Isso cobre o resto da classe: `updateSort` do cabeçalho da tabela, chips da
view Faixas e o voltar/avançar do browser. Ao adicionar controle no painel, use `updateParams`;
se precisar navegar na hora, navegue **a partir do rascunho** (como `applyPreset`/`clearAll`).

## Em σ, use LIMIAR — nunca argmax

Os chips de "atributos em destaque" do card mostram o que passa de **|z| ≥ 1σ** (até 3), com o σ
**impresso**. Não é estilo: o `work-signature.ts` rotulava a obra pelo ARGMAX do z-score e foi
removido em 2026-08-05 porque o campeão vencia por margem < 0,25σ em **47%** do catálogo —
remedido em 06-08 e deu **46,9%**. Com limiar, 93,5% das obras têm ≥1 destaque (mediana 3), e o
σ impresso deixa a margem visível em vez de afirmar um "dominante" que o dado não sustenta.

A cor diz **direção** (acima/abaixo do catálogo), nunca valor — Tragédia +1,3σ não é boa nem
ruim. Quem opina é o ▲/▼, que cruza com `score_weights`; para peso NEGATIVO, "contra" só quando
`score > threshold`, porque abaixo dele o `calculateGPT` não penaliza nada.
⚠️ `score_weights` é tabela COMPARTILHADA — o ▲/▼ herda a Fase 3, igual à Nota.IA, que já lê
essa mesma tabela global no recalc per-usuário.

## Tag amada tem DOIS níveis, e o segundo é forma — não um verde mais escuro

A ênfase **2×** (`user_tag_preferences.weight ≥ STRONG_TAG_WEIGHT`, o botão ✨ de
`/preferencias`) aparece no chip como **♥ preenchido** (amada) ou **⊘** (evitada), e as fortes
vêm **primeiro** dentro do bloco. Três superfícies, um componente só
(`components/ui/tag-stance-mark.tsx`): card Tags da obra · prévia e popover do comparador ·
"Informações sobre a obra" da `/fila-recomendacao`. Régua desde 2026-08-08.

Medido no clone local (981 obras, 164 declarações): **895 obras (91,5%)** misturam os dois
níveis no mesmo bloco "Amadas", **43%** dos chips amados são 2× (4.851 de 11.364), mediana de
**11,6 amadas por obra** (máx. 56). Não é caso raro — é metade de um bloco inteiro pintado igual.
Do lado vermelho é o oposto e por isso importa mais: evitada forte existe em **32 obras**, e era
exatamente ela que sumia entre três evitadas comuns.

🔴 **O sinal é FORMA porque os dois níveis dividem a mesma cor de stance.** Trocar o glifo por
"um verde mais firme" devolve o problema pra quem enxerga cor com dificuldade — e, com 43% dos
chips no nível forte, o gradiente vira ruído em vez de leitura.

⚠️ **`STRONG_TAG_WEIGHT` (`lib/tags/segment.ts`) é o dono único do limiar.** Ele já governava o
filtro "Esconder tags evitadas → só as fortes" (`hide_avoided=strong`), onde estava **copiado**
como `>= 2` em `/ranking` e `/favorites`. Uma 3ª cópia é como a tela marca de forte uma tag que
o filtro não esconde — mesma armadilha do `LOW_BALANCE_USD`.

⚠️ **Tag vinda do PERFIL de gosto nunca é forte, de propósito.** A régua de lá é `strength` 0–1
(inferida pelo modelo; medido: 0,55–0,95, média 0,78) — outra escala, cujo "alto" precisaria de
um limiar inventado. Por isso `TagStanceInfo` carrega `source: "declared" | "profile"`: sem ele o
tooltip diria "você marcou" sobre algo que ninguém marcou, e a pessoa iria procurar em
`/preferencias` uma linha que não existe.

⚠️ **Quem RESSORTA depois do `segmentTags` precisa de `strong` como 1ª chave.** A partição por
nível é estável, mas a página da obra reordena por proveniência (externa antes de IA) — omitir
`strong` ali desfaz a partição em silêncio, e os dois níveis voltam a se intercalar.

**Fora da régua, de propósito:** `/preferencias` (é onde a ênfase se DECLARA — já mostra o 2×) e
os chips do perfil em `/conta` (régua `strength`, não `weight`; mesmo desenho ali afirmaria que
os dois números são o mesmo).

## A `/conta/perfil` PROVA que entende você — e três números mentem se forem "melhorados"

`components/conta/taste-profile-panel.tsx` + `lib/ai-recommendation/profile-tag-origin.ts`
(v3, 2026-08-09). A página responde UMA pergunta — "o quanto vocês entendem meu gosto?" — e a v2
respondia em **4.020px com a prova em 6º lugar**. Hoje é **hero + 4 abas** (A prova · Seus
critérios · Tags e temas · O que isso muda). O estado das abas mora no componente PAI: os painéis
desmontam, e estado dentro deles zeraria a cada ida e volta.

**A manchete é concordância INDEPENDENTE, não correlação.** `getRatedWorksForProfile` manda obra
(título, notas, sinopse, critérios, tags) e **nunca** manda `user_tag_preferences` — conferido no
código. Então tag que aparece nos dois lados com a mesma stance é evidência, não eco. Medido no
v23: **17 de 17 concordam · 23 a IA descobriu sozinha · 130 declaradas ficaram fora do destilado**.
🔴 Se um dia o prompt do perfil passar a receber as preferências declaradas, isto vira **circular**
e a seção tem que SAIR da tela — a UI não percebe sozinha.

Os três números que ficam piores quando alguém tenta melhorá-los:

1. 🔴 **Só declaração de nível TAG conta.** `getDeclaredTagPreferences` EXPANDE grupo/subgrupo pra
   todas as tags membras — certo pro ranker, e aqui infla de graça: quem marca um grupo inteiro faz
   qualquer tag dele "concordar" sem nunca ter opinado sobre ela. Medido: com expansão, **314
   declaradas e 23 concordâncias**; só nível tag, **147 e 17**. Dono do limiar:
   `COUNTS_AS_DECLARATION`.
2. 🔴 **O "N de 20" fica no ALINHAMENTO, nunca na Nota Prevista.** Pela Prevista dá número melhor —
   **18 de 20, corr. 0,851 contra 0,769** — e errado: `calculations.ts` treina o Ridge nas obras
   COM `user_score` e prevê pra TODAS, inclusive essas, então o `expected_score` persistido delas é
   **in-sample**. Seria o modelo confirmando o rótulo em que foi ajustado. Por isso
   `getAlignedWorkSplit` ordena as TRILHAS por `expected_score` em **cópias** — o array original
   segue por `personal_fit`, de que a confirmação depende.
3. ⚠️ **Stance oposta é CONFLITO, nunca confirmação.** Somar os dois transformaria discordância em
   prova de acerto — o único caso em que a manchete sobe enquanto o entendimento piora.

🔴 **TAG ≠ TEMA, e a diferença é FUNCIONAL.** `computePersonalFit` só consome
`loved_tags`/`avoided_tags` + critérios: um TEMA (frase livre da IA) não existe no catálogo, não
casa com obra nenhuma e **não entra no cálculo do alinhamento** — só contextualiza prompts. Por
isso a distinção é de **FORMA** (pílula × linha de texto), não de cor: os dois já dividem a cor de
stance, e frase de ~60 caracteres nunca foi chip.
⚠️ Coração de **contorno**, nunca preenchido — o preenchido é o marcador de ênfase 2×
(`TagStanceMark`, 3 outras superfícies), e tag de perfil **nunca é forte** (escala `strength` 0–1).

⚠️ **As 9 `criterion_preferences.note`** (uma frase da IA por critério) existiam no banco desde
sempre e a v2 **não mostrava nenhuma** — era o dado mais explicativo do perfil, 100% invisível. Na
linha do critério, **faixa** (`ideal_min`–`ideal_max`) e **peso** são campos ROTULADOS e separados:
na v2 a barra desenhava a faixa e o "%" ao lado era o peso, sem nada dizendo que eram grandezas
diferentes — em Humor a barra é larga (4–8,5) com peso 50% e em Romance é estreita (7–9,5) com 90%,
então "barra maior = número maior" se invertia.

A página inteira é saída de LLM: reusa `AiProvenanceSeal` (não faça outro selo). Guardada por
`tests/unit/ui/perfil-gosto-painel.test.tsx`, que é teste de **RENDER** de propósito — a `note`
fora da tela, o tema com forma de tag e o mesmo número impresso duas vezes passariam verdes num
teste que lesse o objeto do perfil.

## Inline type imports and Turbopack

Turbopack (Next.js 16) fails to parse `import { type Foo }` inline syntax when a client component is traversed from a server context. Always use separate `import type` statements:

```ts
// ❌ breaks Turbopack
import { workFormSchema, type WorkFormValues } from "@/lib/validations/work.schema"

// ✅ correct
import { workFormSchema } from "@/lib/validations/work.schema"
import type { WorkFormValues } from "@/lib/validations/work.schema"
```

Also: files without extensions (e.g. `work-form` alongside `work-form.tsx`) are resolved by Turbopack before the `.tsx` file. Rename any such files to `.bak` or `.unused`.

## `output: "standalone"`: `npm start` ≠ `next start`, e o servidor não lê `.env`

`next.config.ts` usa `output: "standalone"` (pacote enxuto pra imagem Docker). Isso muda o servidor de
produção, e três coisas falham **sem erro claro** — todas resolvidas em prod pela plataforma (Fly), mas
que mordem ao rodar local:

- **`next start` NÃO funciona** com standalone (o próprio Next avisa e sobe um servidor que não serve
  a build). O servidor certo é `.next/standalone/server.js`. `npm start` já aponta pra
  `scripts/start-standalone.mjs`, que faz isso — **não troque de volta pra `next start`**.
- **`public/` e `.next/static/` ficam FORA do pacote** (num deploy real vão pro CDN). Sem copiar pra
  dentro, o servidor responde **200 com a página inteira sem CSS e sem JS** — parece bug de estilo, é
  de deploy. O Dockerfile copia (linhas 21-23); o script `start-standalone` reproduz local.
- **`server.js` não lê `.env.local`** (em prod quem injeta as env é a plataforma). Sem isso, toda
  página morre com `supabaseKey is required` numa tela genérica. O script injeta local.

Corolário do file tracing: ele erra pro lado de **incluir demais**. Já puxou `.cache/comix-chrome/`
(o Chrome de 90 MB do sidecar, que o Next nunca executa) pra dentro do artefato —
`outputFileTracingExcludes: { "**/*": [".cache/**"] }` corta. Ao adicionar dependência pesada que só um
sidecar usa, confira se ela vazou pro standalone (`du -sh .next/standalone`).

## Preferência de UI que o servidor renderiza vai em COOKIE, nunca em localStorage

O servidor **não enxerga** `localStorage`. Se o estado inicial de um componente é lido dele, o HTML
do SSR sai com um valor e o primeiro render do cliente sai com outro — a **hidratação quebra** e o
React descarta a árvore inteira e re-renderiza.

Isto já custou caro: o colapso da sidebar morava em `localStorage`, e **toda navegação** com o menu
recolhido jogava `Hydration failed` + `Cannot read properties of null (reading 'parentNode')` no
console — e o menu **piscava** de expandido pra trilho. Sobreviveu meses porque o sintoma parece
ruído de dev e "o app funciona".

```ts
// ❌ o servidor não sabe disto → SSR diverge do cliente
const [collapsed, setCollapsed] = useState(() => localStorage.getItem("x") === "1")

// ✅ cookie: o layout (servidor) lê e passa como prop → os dois lados começam iguais
// app/layout.tsx:  const collapsed = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1"
// <Sidebar defaultCollapsed={collapsed} />
```

Ver `lib/sidebar-preference.ts`. Duas armadilhas vizinhas:

- **`adjust-during-render`** (setState durante o render quando o pathname muda) dispara **na própria
  renderização de hidratação** se o "último valor sincronizado" começar em `null`. Semeie-o com o
  valor inicial — senão ele roda antes da hidratação terminar e recria o mesmo bug.
- **Nome de cookie não aceita `:`** (não é token válido no RFC 6265). Use `sidebar_collapsed`.

## Dados do "chrome" têm TRÊS estados, e o terceiro é clicável

Componentes do chrome (chip da conta, badges, saldo) buscam via `useChromeData` **no cliente** —
existe uma janela real em que o dado é `null`. Tratar `null` como "vazio/não logado" é um bug: o menu
da conta, na primeira versão, abria **sem o "Sair"** nessa janela — um app aparentemente sem logout.
Renderize um estado de carregamento explícito e **nenhuma ação de auth/irreversível** até o dado
chegar. Pra testar esse ramo, atrase a server action no Playwright (`page.route` + delay quando
`headers()["next-action"]`) — em dev ela resolve rápido demais e o estado nunca aparece.

## Supabase: o `select` corta em 1000 linhas, sem avisar

`supabase.from(x).select(...)` devolve **no máximo 1000 linhas** por padrão, **sem erro e sem
aviso** — a query "funciona" e você trabalha com um recorte achando que é o universo.

```ts
// ❌ silenciosamente truncado (work_reviews tem ~14k linhas)
const { data } = await sb.from("work_reviews").select("work_id, source")

// ✅ pagine
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from("t").select("...").range(from, from + 999)
  if (!data?.length) break
  linhas.push(...data)
  if (data.length < 1000) break
}
// ✅ ou, quando só precisa contar
const { count } = await sb.from("t").select("*", { count: "exact", head: true })
```

Isto já custou caro: um backfill mirou em **22** obras quando o alvo real eram **339**, e teria
terminado "com sucesso" tendo processado 6% do trabalho. É o padrão mais perigoso do projeto —
**um erro que produz resultado**. Ao contar qualquer coisa acima de ~1k linhas, confirme com
`count: "exact"` antes de confiar no `select`.

## Constants generated from DB

These files are **fully overwritten** by `npm run sync-constants` and must not be edited by hand:

| File | Source table(s) |
|---|---|
| `lib/constants/criteria.ts` | `criteria` (eval_type=IA) + `publication_status` + `personal_status` + `source` |
| `lib/constants/post-reading-criteria.ts` | `criteria` (eval_type=User) |
| `lib/constants/tag-groups.ts` | `tag_group` |
| `lib/constants/tags.ts` | `tags` + `genres` (autocomplete catalog) |
| `lib/constants/ui-labels.ts` | `ui_labels` (`LABELS` keyed by field → `{full, short, abbrev, tooltip_full, tooltip_short}`; free-floating UI names/tooltips not owned by another table) |
| `lib/external/types.ts` | `source` (ExternalSourceId only, rest preserved) |
| `lib/external/source-order.ts` | `source` (`EXTERNAL_SOURCE_ORDER`, coluna `order`; só o bloco entre os marcadores `<generated:external-source-order>`). ⚠️ Esta ordem governa DOIS usos ao mesmo tempo: a EXIBIÇÃO das fontes no diálogo E a PRIORIDADE das reviews no prompt da IA (`REVIEW_SOURCE_PRIORITY` em `index.ts` é DERIVADA dela). Mexer no `order` do Supabase muda os dois. |
| `types/domain.ts` | `PUBLICATION_STATUSES`, `PERSONAL_STATUSES`, `PLATFORMS`, `CRITERION_SLUGS` arrays |

The canonical list of AI evaluation criteria (`CRITERION_SLUGS`) comes from the `criteria` table where `eval_type = 'IA'`. Any change to criteria must go through the DB and then `sync-constants`.

`sync-constants` also backfills `work_tags` from the legacy `works.genres` text array using the `genre` tag group.

## Scoring pipeline

> **History (read this first):** the original pipeline had four named scores — Nota.IA → Nota.Calc → Nota.Pr → Nota.Final. The `Nota.Pr` + `Nota.Final` stage was **retired** and replaced by a single **Nota Prevista** (`expected_score`). `lib/calculations/final.ts`/`stacker.ts` were deleted and the `final_score`/`predicted_score` columns dropped in migration 099 (2026-06-14); `lib/calculations/prediction.ts` (dead code, no callers) has since been removed too. The user-facing score is now **Nota Prevista**; **Nota.Calc** lives on as an internal ensemble anchor.

Today a work's score flows through three stages:

1. **GPT (Nota.IA)** — weighted sum of `category_scores` using `score_weights`. Negative-weight criteria (drama, tragedy) only penalise when above `max_negative_threshold`. Result is clamped 0–10 then amplified: `GPT.N = 5 + (GPT - 5) × 1.25` (`lib/calculations/gpt.ts`).

2. **Nota.Calc** (`calc_score`) — blends GPT.N with platform average using Bayesian pseudo-vote pooling, then applies chapter and observation penalties (`lib/calculations/score.ts`). Computed both with and without the observation nudge (`calcScoreNoObs`). Persisted as `calc_score`; kept as a feature/ensemble anchor for stage 3, not shown to the user as the headline score.

3. **Nota Prevista** (`expected_score`) — the headline predicted score. A **single Ridge regression** (`trainExpectedPredictor` in `lib/calculations/expected.ts`) trained on works with a manual `user_score`. Features: the 9 category scores, GPT.N, platform avg, log(votes), chapters, synopsis quality, loved/avoided tag overlap, criterion-fit score, release age, run length, plus categorical publication status (one-hot) and origin country. (8 post-reading "quality" features are added only on the paid plan via `includeQuality`.) The Ridge output is then **blended with Nota.Calc** (`calcScoreNoObs`) using a weight grid-searched on out-of-fold predictions to avoid leakage — `w = 1` (no blend) when training set < 30 or the model is a stub. The observation adjustment is **not** a feature; it is added deterministically once after the blend. Below `MIN_TRAIN = 20` labelled samples the predictor falls back to the training mean. Persisted as `expected_score`.

Recalculation is triggered server-side by `recalculateAll()` in `server/actions/calculations.ts`, sempre via
a fila em `server/recalc/queue.ts` (debounce de 1h; um teste de arquitetura garante que só o runner
importa). ⚠️ **Não existe recálculo por obra** — `recalculateWork` foi citado aqui por muito tempo e
**não existe no código** (conferido 2026-07-29: zero referências). Toda edição de dado custa uma leitura
do catálogo inteiro: **5,3 MB** por rodada (medido). É o maior consumidor de egress do projeto. The honest cross-validated MAE of Nota Prevista is stored in `formula_config` (`cv_mae_expected`). Since the `user_score` label switched from craft to **taste** (2026-07-16 — the average of the 7 fixed taste axes, excluding the "Final"; see `computeTasteUserScore`), the absolute cvMAE rose to **~0.73** (was ~0.58 under craft). This is a **scale artifact**, not a regression: the taste target has a wider spread (σ 0.95→1.25, baseline MAE 0.73→0.98), so normalized the model is slightly better (cvMAE/baseline 0.79→0.75). Don't read the raw ~0.73 as "the model got worse".

## O badge "Recalcular notas" só acende com mudança MATERIAL

`markRecalcPending` é chamado de **30 lugares** e o default é MARCAR — e isso está
certo: não marcar deixa nota velha na tela sem nada acusar. O preço era o badge
acender por salvar uma sinopse, por marcar "Lendo" e por ação de leitor cujo estado
o recalc global nem lê.

A régua é **`lib/calculations/recalc-inputs.ts`**, dono único da lista do que o
`recalculateAll` de fato consome (o `select` de `calculations.ts` cruzado com as
features de `expected.ts`), em dois grupos:

| Grupo | Entradas | Vale para |
|---|---|---|
| **Catálogo** | `category_scores`, `platform_ratings`, `total_chapters`, `year` (+`year_end`), `publication_status`, `original_title`, `work_tags`, `catalog_membership` | qualquer um que mexa |
| **Pessoal** | `user_score` (o RÓTULO), `observation_adjustment`, `synopsis_quality`, `attribute_bias`, `tag_preferences`, `taste_profile` | só o **DONO** — é o dele que o recalc global lê |

⚠️ **Fora da régua, conferido:** `personal_status_id`, `chapters_read`,
`last_read_at` e `is_favorite` (estão em `PERSONAL_COLUMNS`, mas em nenhuma
feature) e as 8 `post_*_score` — `QUALITY_NUMERIC_FEATURES` é array VAZIO e
`L0_QUALITY_ENABLED = false`. A pós-leitura entra por UM caminho só, o
`attribute_bias`. Sinopse, capa, títulos alternativos e external ids também não
entram — e note que `work_tags` ENTRA enquanto `work_genres` não.

`markRecalcPending(context, { changed, actorId })`: `changed` omitido = "não sei"
e marca; `[]` = não marca; só-pessoal de quem não é o dono = não marca.

🔴 **O gate falha ABERTO, de propósito.** Dono indeterminado, `changed` ausente,
dúvida de qualquer tipo ⇒ marca. Um badge a mais custa um clique; um a menos
devolve nota errada, calada.

Três armadilhas que custaram a descobrir:

- 🔴 **`numeric` do PostgREST volta como STRING.** Sem `sameRecalcValue`,
  `"8.5" !== 8.5` e todo diff diria "mudou" — o gate nasceria inútil, marcando
  sempre, e **ninguém notaria**, porque o resultado é idêntico ao de antes.
- ⚠️ **`platform_ratings` é delete-e-reinsere**: "houve escrita" é sempre verdade e
  não diz nada. Compare VALOR (digest ordenado), nunca "passou pelo código".
- ⚠️ **`createWork`/`createWorksBatch` continuam marcando de propósito** — é assim
  que a obra nova ganha a primeira Nota Prevista. Obra sem rótulo não entra no
  treino (imputer e scaler são fitados só nele), mas `personal_fit_percentile` é
  percentil sobre o catálogo inteiro.

Declaram materialidade hoje: `updateWork`, `updateWorkStatus`,
`submitPostReadingAttributes`, `saveTagPreferences` e `taste_profile_new_version`.
`setReadingStatusForWorks` **deixou de marcar** (só grava status e capítulos). Os
demais marcam sempre.

⚠️ **Ainda marcam à toa, conhecido e não escondido:** `updateWorkExternalData`
quando "Atualizar dados" não acha nada novo; `setSynopsisQuality` e
`calibration-revert` quando regravam o mesmo valor.

O `context` — que era descartado — vai pro log com prefixo `[recalc-pending]`,
marcou ou pulou. É a única medição que existe da frequência real por caller:
`grep '\[recalc-pending\]'`, não estimativa.

Guardado por `tests/unit/calculations/recalc-inputs.test.ts` e
`tests/unit/orchestration/recalc-pending-inventario.test.ts` — este último enumera
os call sites do SOURCE e falha quando um aparece, some ou muda de declaração, que
é a defesa contra o próximo caller entrar no badge sem ninguém decidir nada.

## AI evaluation flow

Two distinct paths both ultimately call `requestAiEvaluation()` in `lib/ai-evaluation/service.ts`:

**Path A — "✨ Avaliar" (`/ai-evaluation`, "Curadoria da Obra")**

⚠️ A página virou **duas** em 2026-08-02: `/ai-evaluation` ficou só com a fila de **atributos**
(curadoria do catálogo — do dono), e as filas de **Veredito IA / IA-Rk / Interesse / Sinopse**
foram pra **`/fila-recomendacao`** (qualquer logado). O badge da barra também se dividiu:
`curadoria` e `rec-queue`. `/ranking/desatualizados` segue como redirect pra aba nova.
`triggerAiEvaluation(workId)` → `fetchExternalEvaluationContextForWork()` → `requestAiEvaluation()`
- Uses saved work data (**ALL persisted synopses**, genres, grouped tags, cover). The primary synopsis is the prompt's main reference; every other persisted synopsis enters as `[S1]…[Sn]` blocks (`splitSynopsesForEvaluation` in `lib/work-derived.ts`), with `source = "manual"` ones labeled as user-written/high-authority. Fresh external `[C]` blocks that duplicate a persisted synopsis are filtered out (`isSameSynopsis`) — but only when additional synopses exist, so single-synopsis works keep a byte-identical input and preserve the eval cache `input_hash` (the `additionalSynopses` field is omitted from both hash versions when empty). If the work has accepted `work_external_ids`, reviews/context are fetched from those confirmed source IDs; otherwise it falls back to title search.
- Review sources (each only when the candidate has that source's ID): MangaUpdates + AniList + MyAnimeList + Kitsu (reactions) + AnimePlanet + MangaDex (forum comments) + ComicK (curated reviews + comments) + Comix (per-work comment thread, mini-reviews). Comix has no formal reviews API; `fetchComixReviews(hid)` walks detail `id` → `threads/lookup?page_identifier=manga{id}&page_url=/title/{hid}` → `threads/{threadId}/comments` (cursor-paginated). ⚠️ Este caminho é **TOKEN-FREE**: usa `fetchComixDetailRaw`/`fetchComixThreadJson`, **não** o `fetchComixJson` — então o circuito de auth aberto pela busca gateada **não** o bloqueia (medido 2026-08-04: circuito aberto e, na sequência, 52 e 57 reviews normais em ~1,3s). Hoje ele resolve por **plain fetch**, com resultado IDÊNTICO sem bypass, só com sidecar e com sidecar+FlareSolverr. 🔴 Isso é estado ATUAL, não garantia: os dois passos têm fallback de CF (`fetchComixHtml` → `isCfBypassUnavailable()` → `fetchHtmlWithCfFallback`), então se a Comix voltar a desafiar, ~30% do acervo de reviews passa a depender do bypass da noite pro dia.
- Reviews go through `selectReviewsForEvaluation()` before the prompt — stratified per-source sampling with an **adaptive** quota: `perSource = min(maxPerSource, ceil(total / sourcesWithReviews))`, capped by `AI_EVAL_REVIEW_CAPS = { total: 30, maxPerSource: 12 }` (service.ts), then global round-robin in `REVIEW_SOURCE_PRIORITY` order (MangaUpdates first). So few-source works fill the budget (2 sources → up to 24, not 16) instead of being stuck at a fixed 8/source. All sources are always fetched in parallel; the cap is applied at selection time only (no fetch short-circuit). The full pool persists to `work_reviews`. **The prompt selects from the UNION of fresh fetch + persisted `work_reviews` pool** (`mergeFreshWithPersistedReviews`, dedup by source+text, rejected sources filtered): CF-gated sources dropping out (sidecar 503 busy / Cloudflare block) can no longer shrink the evidence to 1–2 reviews when dozens are already persisted. Only the fresh pool is re-persisted (persistence semantics unchanged); when nothing is recovered the input is byte-identical to fresh-only, preserving the eval cache `input_hash`.
- Passes `sourcedReviews: SourcedReview[]` (rich format with source, matchScore, sourceTitle)
- Also passes `externalContext` (synopsis strings from external sources)
- Saves results to `ai_evaluations` + `ai_evaluation_scores` tables
- User reviews and optionally edits scores before they're committed to `category_scores`

**Path B — "✨ Buscar dados" form (`/titles/new`)**
`searchAllSources()` → user chooses candidate → `fetchMultiSourceDetails()` → user chooses final data → `evaluateCandidateForCreate()` → `requestAiEvaluation()`
- "Buscar dados" only finds candidate/source matches. "Usar" extracts metadata, lets the user pick synopses/covers/conflicts, then runs AI against the final selected data.
- Review/context sources come from the accepted external IDs for the selected candidate, not from a second independent title search.
- Passes `sourcedReviews: SourcedReview[]`; final selected synopsis is sent as the primary synopsis. Extra external context is omitted when a selected synopsis exists to avoid evaluating unselected synopsis blocks.
- Scores go into form fields; if saved unchanged they are persisted as `source: "ai_accepted"` with an `ai_evaluation_id`
- Works with all 9 criteria set get `ai_eval_status = "done"` and skip the Avaliar queue
- Completed AI evaluations that still need review use `ai_eval_status = "review_pending"`

Post-processing applied to every evaluation (in `service.ts`):
- ⚠️ O piso/teto por TAG saiu do código e virou **dado** em `tags.adult_score_tier` (migration
  **174**, 2026-08-02): antes eram três `Set`s hardcoded em `lib/ai-evaluation/adult-content-rules.ts`,
  enquanto o FLAG `works.is_adult` já lia `tags.adult_indicator[_strong]` do banco — as duas fontes
  divergiam, e tag nova classificada pelo enricher afetava o flag mas nunca o piso da nota.

🔴 **`explicit` afirma que a CENA é mostrada — não que haja sexo no enredo.** A lista migrada
na 174 misturou atos gráficos (Cunnilingus, Anal Sex) com tags de **circunstância**: que vez
(`First-Time Intercourse`, 83 obras), em que estado (`Drunken Intercourse`), onde
(`Outdoor/Public/School/Office/Toilet`), posição (`Doggy Style`, `Missionary Position`) e até
`Clothed Intercourse` — sexo **vestido** valendo piso 9,0 = "há cena de sexo explícito".
Corrigido pela **migration 182** (2026-08-09): as 18 viraram `label` (piso 7,0, a faixa "sexo
mostrado PARCIALMENTE"), que é o que elas de fato sustentam. `explicit` foi de 46 → 28.

Medido antes: **64 obras** tinham como única evidência de "explicit" uma tag de circunstância,
**todas** em 9,0–9,5, e em **24 delas a prosa da própria avaliação argumentava faixa 0-3 ou 4-6**
— ex.: *"Faixa 4-6 (Suggestive): … os leitores afirmam que a obra NÃO é smut/explícita"*, obra
persistida em 9,0 por causa de `Drunken Intercourse`.

🔴 **Baixar um piso NÃO desfaz o que ele subiu.** `clampAdultContentScore` é one-way — só empurra
pra dentro da faixa. Sem `scripts/adult-content-retroactive-bounds.ts --heal`, as 64 ficariam
congeladas em 9,0 e o script diria "nada a gravar". O `--heal` só age sob um fingerprint estreito:
nota persistida ACIMA da que a avaliação entregou **E** valendo exatamente um piso (9/7/5) **E**
não sustentada pelos limites de hoje. ⚠️ A 1ª versão usava a nota da avaliação como baseline
direto e o dry-run deu **219** diffs contra as 51 reais — ela reescrevia toda divergência entre
`category_scores` e `ai_evaluation_scores`, inclusive ajuste manual posterior. Ampliar esse
critério é apagar curadoria em silêncio.

⚠️ **O embed do PostgREST traz os NOVE critérios.** `ai_evaluations(ai_evaluation_scores(...))`
sem `.eq("ai_evaluations.ai_evaluation_scores.criterion_slug", "adult_content")` devolve todos, e
pegar `[0]` dá o baseline de outro critério — mediu 8,0 numa obra cuja avaliação dizia 7,0, e o
relatório saiu inteiro plausível. Erro que produz resultado.
✅ **A 174 está aplicada na nuvem** (confirmado 2026-08-07). Esta seção afirmou o contrário
por dias — ver o aviso logo abaixo.

✅ **As migrations 174, 175 e 176 estão aplicadas na nuvem** (confirmado 2026-08-07). Este bloco
dizia "pendentes" desde 08-02/03-08 e **continuou dizendo depois de aplicadas** — um 🔴 falso que
carrega em toda sessão e induz a reaplicar migration ou a segurar deploy sem motivo. O que cada
uma fez, que segue valendo:

| # | Tabela | O que trouxe |
|---|---|---|
| 174 | `tags.adult_score_tier` | tirou do código os três `Set`s de piso/teto por tag |
| 175 | `recommendation_chats.user_id` | deu dono ao chat (sem ela o insert falhava) |
| 176 | `ai_eval_read_acks.user_id` | deu dono ao "marcar como lido" |

⚠️ A 176 **trocou a PRIMARY KEY** de `(work_id, queue)` para `(user_id, work_id, queue)`, e o
`onConflict` do upsert em `server/actions/ai-eval-read.ts` acompanha. Os dois já estão no ar
juntos; separá-los de novo (revert de um só) troca "ack de cada um" por "último que clicou
vence", em silêncio.

🔴 **Lição de manutenção, mais cara que as migrations em si:** status de migration envelhece e
**nada avisa**. Um bloco 🔴 desatualizado é pior que ausência de bloco, porque ele é lido como
verdade conferida. Ao anotar pendência aqui, escreva a **data** e a **forma de conferir**
([[project-conferir-migration-na-nuvem]]) — e apague o aviso no mesmo PR que aplica.
- `enforceR19AdultContentRule`: raises `adult_content` to ≥ 7.0 if R19 marker detected anywhere in input
- `enforceExternalContentRatingRule`: raises `adult_content` to a floor from the accepted external sources' content rating (MangaDex `contentRating` / ComicK `content_rating`) — `suggestive`→5, `erotica`→7, `pornographic`→8. Chained with the R19 rule; both are monotonic so the effective floor is the max of whichever triggered.
- ~~`enforceNeutralCoupleDynamicsWhenNoRomance`~~: **removido na v23** (2026-08-09). Forçava `couple_dynamics = 5.0` quando `romance ≤ 3`, partindo de "sem romance, não há dinâmica" — premissa que morreu com a ampliação do critério pra vínculos centrais. Travava **17 das 18** obras sem romance. Quem decide "não aplicável" agora é o prompt, por ausência de VÍNCULO — não de romance. ⚠️ As ~31 justificativas que ele reescreveu seguem no banco (ver `lib/criteria/justification.ts`)
- `enforceAuditableReviewUsage`: **non-fatal since v20 (2026-06-27)** — generic review citation is accepted ("algumas reviews apontam…"), so it no longer requires/validates specific review IDs (`R1`, `R2`…) nor throws. It only records an informational `reviewAudit` (`required` = "havia reviews no prompt"; `usedReviewIds` = whatever IDs the model happened to cite, often empty with generic citation). `review_usage` is now an OPTIONAL tool/schema field. (Earlier behavior: threw + retried when IDs weren't cited — removed because a citation slip discarded otherwise-valid evals.)

## Quem escreve prosa sobre uma obra precisa saber o que os números dela QUEREM DIZER

Ranking e Deep Dive recebem `category_scores: tragedy=6.0, couple_dynamics=8.0, …` como números
**crus** — sem a rubrica e sem as justificativas que os produziram — ao lado das tags em texto e
do digest inteiro. Sem saber que 6,0 em `tragedy` é *"perdas isoladas ou reversíveis"*, o
consultor escreve a prosa a partir do digest e os números viram enfeite.

Medido em 2026-08-09 sobre **281 itens de ranking** persistidos: **21 descrevem abuso,
toxicidade ou violência numa obra cujo `couple_dynamics` ≥ 7** — a faixa que significa relação
**saudável**. Caso real (`tragedy=6.0`, `couple_dynamics=8.0`): *"o tom é predominantemente 'dark
ambience' com abuso físico extremo e tragédia como pano de fundo constante"* — vocabulário da
faixa 9-10 sobre um 6,0, com a lista de atributos ao lado na mesma tela.

A correção é uma constante só, em `lib/ai-recommendation/prompts.ts`:

| | |
|---|---|
| `CRITERIA_SCALE_LEGEND` | os rótulos das 4 faixas dos 9 critérios, **derivados de `CRITERIA_RUBRICS`** |
| `CRITERIA_COHERENCE_RULE` | proíbe prosa que contradiz o número; manda **declarar** a divergência |

🔴 **A legenda é DERIVADA, nunca escrita à mão.** `sync-constants` reescreve as faixas a partir
do banco; uma cópia literal aqui é a 2ª régua pro mesmo número — mesma armadilha do
`LOW_BALANCE_USD` e do `STRONG_TAG_WEIGHT`. Só os **rótulos** entram (o texto antes dos
dois-pontos): a rubrica inteira são ~5k caracteres e o que falta ali é vocabulário de
intensidade, não a casuística.

⚠️ **A legenda precisa avisar que `couple_dynamics` é valência** — senão ela ENSINA o erro:
"0-3 Destrutiva" lido na chave de presença vira "quase não tem dinâmica", que é o oposto.

⚠️ **Quando o digest contradiz os atributos, isso é INFORMAÇÃO — não um empate a resolver em
silêncio.** A regra manda registrar a divergência em `risks` nomeando os dois lados e abaixar o
`confidence`. Escolher um lado sem dizer que havia outro é o que faz a mesma obra ser descrita de
dois jeitos em duas telas. E a regra diz explicitamente que **não** é permissão pra ignorar as
reviews — senão conserta um viés e abre o oposto.

⚠️ **São DOIS consumidores, e o Deep Dive tem uma cópia PRÓPRIA de `formatCategoryScores`** — é
fácil corrigir só o ranking e achar que acabou. Guardado por
`tests/unit/ai-recommendation/legenda-de-faixas.test.ts`, que verifica os dois prompts.

✅ **O que NÃO era problema, medido:** a suspeita de que avaliação e digest liam amostras
diferentes das mesmas reviews. Os tetos de fato divergem (avaliação 30 total/12 por fonte,
estratificada por **nota do reviewer**; digest 40 total/8 por fonte, as mais **longas**) e 358
obras passam do teto — mas replicando os dois seletores sobre as reviews persistidas, o **Jaccard
mediano é 78,9%** (p10 64,3%, p90 100%, **nenhuma obra abaixo de 50%**). As duas leem
essencialmente a mesma evidência; a discordância entre os artefatos vem da TAREFA, não da
amostra. Unificar os seletores não vale o custo de re-rodar tudo.

## Quatro critérios tinham colapsado numa faixa só — e cada um por um motivo diferente

Medido em 2.393 avaliações (2026-08-09), share por faixa da rubrica:

| critério | 0-3 | 4-6 | 7-8 | 9-10 | σ |
|---|---|---|---|---|---|
| `action_adventure` | 19,9% | **73,5%** | 6,6% | **0,0%** | 1,31 |
| `protagonist` | 0,1% | 18,8% | **77,4%** | 3,7% | **0,87** |
| `romance` | 1,5% | 16,3% | **73,7%** | 8,4% | 1,16 |
| `fantasy_nobility` | 3,4% | 7,4% | 76,2% | 13,0% | 1,42 |

Isso custa duas vezes: **feature quase-constante não contribui nada pro Ridge** da Nota Prevista
e não discrimina em filtro nem em ordenação do `/ranking`. Corrigido na **v25**, com quatro
mecanismos distintos — a tentação é tratar como um problema só, e não é:

🔴 **1. O piso de 5 se sobrepunha à RUBRICA.** Ele existe contra dois vieses reais (baixar por
execução fraca, baixar por silêncio das fontes) — mas estava vencendo até evidência POSITIVA de
ausência. Medido: das 1.027 justificativas de `action_adventure` que afirmam ausência ("slice of
life", "uneventful", "nada acontece"), **316 (30,8%) ficaram ≥5** — enquanto a faixa 0-3 do
critério diz literalmente *"cotidiano, sem conflito externo relevante (slice of life)"*. A prosa
citava a definição da faixa e a nota não ia pra lá. ⚠️ Ao mexer nisto, mantenha explícito o que o
piso ainda protege: corrigir um viés reabre o outro.

🔴 **2. A posição DENTRO da faixa era surda à intensidade que a própria prosa declarava.** Entre
notas 4–6,9, a justificativa com "pontual/esporádico/não domina" distribuía **31/32/35%** (em
4–4,9 / 5 / >5) contra **33/35/31%** da prosa neutra — idênticas. A palavra "pontual" não mudava
o número. Caso real: *"eventos pontuais, sem dominar o tom geral"* → **6,0**, o topo da faixa. A
regra nova tem PRECEDÊNCIA explícita sobre "prefira o valor central" e sobre "use o valor mais
alto da faixa inferior" — sem isso ela nasce letra morta.

🔴 **3. A "REGRA OBRIGATÓRIA" de `fantasy_nobility` virou piso.** Justificativa citando o gatilho
(reencarnação/regressão/transmigração/isekai) → **97,9% ≥7**, média 8,11; sem citar → 81,1% e
7,14. Como **48%** das avaliações citam o gatilho num catálogo majoritariamente isekai/vilã, a
regra deixou de distinguir qualquer coisa. Hoje esses tropos são **dispositivo narrativo**, não
estrutura: uma regressão para um escritório contemporâneo não é `fantasy_nobility` 7-8. ⚠️ O
antídoto ficou escrito no prompt — *"se a sua justificativa poderia ser copiada para metade das
obras do catálogo, ela não é evidência de 7-8"*.

🔴 **4. `protagonist` perdeu a AGÊNCIA do gate.** A faixa 0-3 abre com *"sem agência, decisões
irrelevantes"*, mas o prompt só autorizava faixa baixa pra "ESQUECÍVEL / GENÉRICO / SEM
PERSONALIDADE / SUBSTITUÍVEL". Medido: das **151** justificativas que chamam o protagonista de
passivo ou sem agência, **51% ficaram ≥7** — a faixa que exige "agência clara, decisões movem a
trama" — e só 9 abaixo de 5. ⚠️ A régua que separa os dois casos: *"Mary Sue", "irritante",
"fria" são sobre COMO ele é e não rebaixam; "passivo" e "sem agência" são sobre O QUE ELE FAZ e
rebaixam.* Sem essa distinção nomeada, consertar a agência reabre o viés de qualidade.

⚠️ **A v25 pulou o v24 de propósito:** `ai_api_calls` tem 65 chamadas de `ai_evaluation` já
rotuladas `v24` (2026-07-29), de uma rodada cujas avaliações foram gravadas como **v22** — o log
e a tabela discordaram. Reusar o número misturaria latência/custo/qualidade do v24 novo com as
fantasmas, e a análise sairia inteira plausível. Guardado em
`tests/unit/ai-evaluation/prompt-version-pin.test.ts`, junto do pin de hash.

## A rubrica tem DUAS naturezas de escala, e `couple_dynamics` é a única de valência

Oito critérios medem **presença/intensidade** (0 = não está lá). `couple_dynamics` mede
**valência**: 0-3 = o vínculo faz MAL a quem está nele, 9-10 = faz BEM. Nota baixa ali não
quer dizer "não tem vínculo".

🔴 **E o slug MENTE: `couple_dynamics` não é sobre casal.** O critério virou "Dinâmica entre
Protagonistas" em `95226f7` (2026-07-27) e as faixas passaram a falar de **vínculos centrais**
— mas a ampliação ficou **pela metade por 13 dias, e nada acusava**: a `description` no banco
continuou "a relação entre o **casal principal**", o guia de tags dizia "apenas quando a tag
descreve o casal", e o clamp de romance seguia vivo. Como `buildCriteriaPromptSection()` cola a
description ACIMA das faixas, o modelo lia título amplo + descrição restrita + rubrica ampla no
mesmo bloco. Fechado pela **migration 181** + v23.

✅ **A 181 está aplicada na nuvem** (2026-08-09, projeto `obwlwu…pizd`). Conferir com
`select md5(description) from criteria where slug='couple_dynamics'` via Management API e
comparar com o local — bateram em `f3b2adbd15b1f4e1d42f1c85373d17b6`. ⚠️ O
`scripts/apply-migration.mjs` deriva o ref do `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`: com o
env apontando pro LOCAL ele não acha ref nenhum e sai. O ref da nuvem mora em
`.env.supabase-cloud` ([[project-conferir-migration-na-nuvem]]).

⚠️ **O vínculo a avaliar tem ORDEM, não é uma lista solta:** casal principal → família (pais,
irmãos, filhos) → demais recorrentes (mestre/discípulo, equipe, rivalidade, amizade). Pegue o
PRIMEIRO que a obra tiver, e diga na justificativa qual foi. Sem a ordem, obra com casal E
família fica ambígua e as notas deixam de ser comparáveis entre si — mesma classe das réguas
misturadas. O **5 significa "sem vínculo central recorrente"** (protagonista isolado), nunca
"sem romance".

Até a **v22** as meta-regras de presença do `SYSTEM_PROMPT` valiam pros 9, e isso produzia
três absurdos silenciosos:

- *"se há QUALQUER evidência de presença, a nota deve ser ≥ 5"* proibia nota baixa sempre
  que existisse um casal — justo o caso que a faixa 0-3 existe pra descrever;
- a coerência justificativa×faixa manda "recorrente/constante" pra faixa ALTA. Em
  `couple_dynamics` "atrito **recorrente**" é uma relação PIOR — a regra estava invertida;
- a exceção que dispensa essas regras listava só `drama` e `tragedy`.

🔴 **E a seção de sinais indiretos mapeava `"possessive but I love it" → 0-3`** — a leitora
declarando que GOSTA virava dano à relação, contradizendo a regra dedicada logo abaixo, que
manda checar consenso/satisfação/tom antes. Medido em 2.393 avaliações: justificativa citando
posse/ciúme/yandere caía em 0-3 em **19,1%** dos casos contra **5,4%** quando não citava (3,5×),
e `couple_dynamics` era **o critério mais instável dos 9** (amplitude média **1,52 pt** entre
reavaliações da mesma obra; 36,7% variando ≥2 pt; pior caso 6,0).

A **v23** (2026-08-09) isenta `couple_dynamics` das três meta-regras, e a regra própria passa a
exigir quatro checagens antes da nota: (a) consenso, (b) satisfação, (c) tom e **(d) linha do
tempo** — em regressão/reencarnação/transmigração, o tóxico da vida ANTERIOR é contexto
estabelecido e não conta (mesma lógica que `tragedy` já aplica ao background). São **496 obras**
com tag desse tipo, 256 delas hoje com `couple_dynamics` ≤ 6.

⚠️ **O sinal decisivo é a REAÇÃO do outro personagem, não a intensidade do comportamento.**
Tag de posse descreve um lado; sem indício de como o outro reage, ela **perde peso** em vez de
puxar pra baixo. E opinião de leitor é evidência sobre o que ACONTECE, nunca sobre se aquilo é
bom pro casal.

🔴 **Mudar o texto do prompt sem trocar a `PROMPT_VERSION` é erro silencioso duplo:** a versão
entra na chave de cache (`canonicalInputHash`) e é gravada em `ai_evaluations.prompt_version`,
então o cache serve avaliação da régua antiga como se fosse da nova e o rótulo no banco mente.
Guardado por `tests/unit/ai-evaluation/couple-dynamics-valencia.test.ts`, que **fixa o sha256 do
`SYSTEM_PROMPT` à versão** — inclusive as rubricas interpoladas de `CRITERIA_RUBRICS`, porque
`sync-constants` mexer numa faixa também muda a régua.

⚠️ **O catálogo hoje é uma MISTURA de réguas.** As notas vigentes vêm de **9 versões de prompt**
(medido 2026-08-09: v19=227 obras, v21=220, v20=152, v18=146, **v22=91**, v17=83, v16=47 — a versão
corrente cobria 9,4%). Controlando por mesmo modelo + mesma versão, a amplitude entre reavaliações
cai de 1,52 para **0,45** — ou seja **~70% da instabilidade medida vem da régua ter mudado**, não do
modelo. Isso contamina toda comparação entre obras: ordenação do `/ranking`, os limiares
`min_<slug>`/`max_<slug>` (em pontos), `ideal_min..ideal_max` do perfil, o Ridge e o `personal_fit`.

The model is `claude-sonnet-5` (`SONNET_MODEL`), prompt version `v23` (toggled by `CONCISE_OUTPUT` in `service.ts`: `v23` concise output / `v18` verbose — flipping it falls back to the old caches; `v21` = concise + **consensus** review citation, `v22` = piso/teto de `adult_content` por procedência, `v23` = `couple_dynamics` como escala de valência), up to 2 attempts (4500 max tokens on **both** attempts; temperature 0.2 then 0). Opus 4.7 and Haiku 4.5 are supported as per-evaluation overrides (the A/B "Reavaliar com…" buttons); Opus 4.7 doesn't accept the `temperature` param. MAE values stored in `formula_config` reflect calibration runs against the current model+prompt; the hardcoded fallbacks in `calibration.ts` (1.27/0.92) are historical defaults from the original spreadsheet — not authoritative.

## Importação (`/import`)

Quatro métodos, **todos pela MESMA reconciliação** (`analyzeExternalListImport` → buckets de
auto-update / conflitos / ambíguos / novas / sem-mudança → `commitExternalListImport`). O input comum é
`ExternalListInput { filename, contentBase64, source?, username? }`; o servidor **re-parseia no commit**
(determinístico), então só recebe as decisões do usuário indexadas por posição.

| Método (`ExternalListSource`) | Como entra | Parser |
|---|---|---|
| Arquivo — `myanimelist` / `mangaupdates` / `animeplanet` | upload (.json / .json / .xml.gz) | `parseExternalList` |
| `anilist` | **API pública por usuário** (`fetchAniListUserMangaList`, GraphQL `MediaListCollection`) — sem arquivo | `parseAniListList` (ordena por `mediaId`: o commit re-busca e a ordem tem que bater) |
| `titles` | **lista colada, um título por linha** (só-título, curadoria em massa do admin) | `parseTitleList` |

Título tem vírgula/`;` no meio → o único separador seguro da lista colada é **quebra de linha**. A
dedup contra o DB é a própria reconciliação (matcher Jaccard + rede `pg_trgm`), igual para todos.

**"Revisar pendentes" mostra SÓ obras criadas por importação** (`getPendingReviewWorks`: junta
`import_rows.status = "imported"` ao filtro `ai_eval_status = "pending"` + não-arquivada). Obra criada
em `/titles/new` **NÃO entra** aqui, mesmo sem avaliação IA — antes entrava e poluía a lista.

### Import multi-user (Bloco 02 do destrave — feito)

O import deixou de ser `ensureAdmin`-only: o gate é `ensureReadingStateWriter` (sessão +
`own_state`), e cada importação registra o dono:

- **Per-user**: `imports.user_id` (migration 170; backfill → dono) + RLS; o estado pessoal da
  lista (nota/status/capítulos) vai pra `user_work_state` de quem importou via
  `writeReadingState` (cliente de sessão). `getPendingReviewWorks`, Histórico e "última
  importação" do `/import` filtram por `imports.user_id`; obra criada é catálogo compartilhado.
- **`buildMatchContext(supabase, userId)`**: o lado "atual" do diff é o estado de QUEM importa
  (works + `user_work_state` dele), não mais o espelho do dono. As três leituras são paginadas —
  `work_external_ids` tinha 6.9k linhas com o índice de match SILENCIOSAMENTE truncado em 1000.
- **Plano free**: sem gate novo, por decisão (2026-07-31) — o leitor importa igual; a aba
  "Revisar pendentes" só INDICA que o enriquecimento usa IA (assinatura/créditos). Recalc:
  dono → fila global; demais → `recalculateForUser` em `after()` (+ fila global se criou obra).

## External data sources

> **Bypass de Cloudflare — leia antes de mexer em fonte externa.** Mangago e AnimePlanet devolvem
> **403 `cf-mitigated`** a um fetch do Node: elas **dependem** de um bypass. A Comix é pior — a API
> dela (`/api/v1/*`) responde `403 Missing token`, e o token vai num parâmetro `_` que **assina a
> query** (não dá pra forjar nem reescrever). Só um browser real resolve.
>
> Há duas camadas, nesta ordem (`fetchHtmlWithCfFallback`):
> 1. **Sidecar `comix-render`** (`services/comix-render/`, Playwright, `COMIX_RENDER_URL`) — `/resolve`
>    descobre a Comix; `/render` atravessa o Cloudflare das demais. **Sobe sozinho em dev** via launchd
>    (`com.geners.comix-render`). Ver o README do serviço: duas armadilhas silenciosas moram lá (flags
>    de automação e `content_rating`).
> 2. **FlareSolverr** (Docker `:8191`) — rede de segurança **e ÚNICA via do ComicK**.
>    🔴 **As duas camadas NÃO são substituíveis** (medido 2026-08-04, 6 buscas por condição):
>    ComicK volta **6/6 com FlareSolverr** e **0/6 com o sidecar sozinho**. Quem cobre Mangago e
>    AnimePlanet é o sidecar (81 e 12 reviews em 4 obras); o FlareSolverr sozinho cobre as duas de
>    forma ERRÁTICA (20 e 4, e só em 2 das 4 obras). Os números de Mangago/AnimePlanet são de UMA
>    rodada por condição — o do ComicK foi remedido com repetição justamente porque o agregado
>    dava 1/4 num cenário e 4/4 noutro.
>
> **Em dev, o Docker/FlareSolverr é OPCIONAL — o sidecar é a camada primária.** O sidecar não tem
> nenhum fio pro FlareSolverr (só o cita em comentário); ele atravessa o Cloudflare com o Chromium
> próprio do Playwright. **Comprovado com o Docker DESLIGADO** (2026-07-22): container parado, porta
> 8191 morta, e `POST :8790/render` de `anime-planet.com/manga/berserk` voltou 200 com HTML real (não
> desafio) em ~3,75s. O FlareSolverr só é acionado se o sidecar devolver `null` (ver
> `fetchHtmlWithCfFallback`). Regra prática: dia a dia pode fechar o Docker; deixe aberto só em
> aquisição pesada (import em massa / backfill), pela redundância.
>
> **MyAnimeList**: metadados vêm da **API oficial v2** (`lib/external/myanimelist.ts`, header
> `X-MAL-CLIENT-ID` ← `MAL_CLIENT_ID` no env; OAuth só serve pra dados de usuário logado). Reviews
> vêm de **scraping direto** (`myanimelist-reviews.ts`) porque a v2 **não tem reviews** — não existe
> endpoint nem campo. O **Jikan** (scraper de terceiros que ficava em 504 e derrubava a fonte inteira)
> foi **apagado**. Sem `MAL_CLIENT_ID`, o MAL degrada em silêncio: some da busca e da média de
> plataforma — e ele costuma ser a fonte com **mais votos** de todas.

`lib/external/index.ts` is the multi-source orchestration layer:
- `searchAllSources(query)` — parallel search across AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList, MangaDex, AnimePlanet, Mangago **e Comix**; merges by title similarity (threshold 0.65 for grouping, 0.72 for accepted)
  - ⚠️ **A Comix ESTÁ em `SEARCH_CONNECTORS`** (esta linha dizia o contrário até 2026-08-04) — mas
    hoje volta sempre VAZIA: `/manga*` exige o token de assinatura `_=` e responde `Missing token`.
    **Não é Cloudflare, é autenticação, e nenhum bypass atravessa** (medido em 3 condições: sem
    nada, só sidecar, sidecar+FlareSolverr — idêntico nas três). Ela devolve `[]` e não erro, então
    **nem em `failedSources` aparece**: some do relatório sem deixar rastro, e num diagnóstico
    agregado isso é indistinguível de "a obra não está na Comix". A 1ª negativa abre o circuito de
    auth (`COMIX_AUTH_CIRCUIT_TTL_MS` = 30min) e as chamadas seguintes custam 0ms — o custo de
    mantê-la na lista é uma requisição falha de ~0,4s por processo. Quem de fato dá o hid a uma
    obra NOVA é o cross-ID do sidecar (`quickResolveComixHidForWork`), que sem `COMIX_RENDER_URL`
    devolve `false` na hora.
- `fetchMultiSourceDetails(candidate)` — hydrates a candidate from all platforms by ID, filters accepted sources (titleScore ≥ 0.72 AND synScore ≥ 0.18 AND composite ≥ 0.62), then calls the AI. Reverse-substring matches ("Fake Lady" inside "The Fake Lady and Her Rabbit Duke") são graduados por proporção pra evitar falsos positivos.

Client-side fetches (ComicK ratings, AnimePlanet ratings) live in `lib/external/client-fetches.ts` and are called directly from `ExternalSearch` component to avoid the server action round-trip.

Review/context fetching is centralized in `lib/external/index.ts`:
- `fetchExternalEvaluationContextForCandidate()` hydrates confirmed source IDs and gathers reviews/context only from accepted sources.
- `fetchExternalEvaluationContextForWork()` is the fallback for works without confirmed IDs; it searches title variants, accepts a candidate, then delegates to the candidate-based context builder.

## Database schema summary

Core tables: `works`, `category_scores`, `calculated_scores`, `platform_ratings`, `score_weights`, `formula_config`, `ai_evaluations`, `ai_evaluation_scores`, `tags`, `tag_group`, `work_tags`, `criteria`, `source`, `imports`, `import_rows`.

AI recommendation tables: `taste_profile`, `recommendation_runs`, `deep_dive_results`, and `recommendation_chats` (conversational recommendation chat — paid-only; 1 row per conversation, messages in a JSONB array with a compact per-turn recommendation snapshot). The chat is a thin layer over `runRecommendationAction` (it reuses the ranker; each recommend turn still creates a `recommendation_runs` row). All Claude calls log to `ai_api_calls`.

RLS está ligada em todas as tabelas e o cliente **anônimo** não lê nada (nem o catálogo) — é intencional:
o catálogo é servido pelo servidor, não pelo browser.

Desde a **migration 142**, as 9 tabelas com dono (`user_tag_preferences`, `attribute_bias`,
`user_attribute_assessment`, `ranking_filter_presets`, `prediction_ledger`, `prediction_snapshots`,
`recommendation_runs`, `user_work_state`, `user_settings`) têm políticas: o usuário **autenticado** só
enxerga e só escreve as **próprias linhas** (`user_id = auth.uid()`). O `with check` é o que impede
escrever uma linha com o `user_id` de outra pessoa.

⚠️ **`user_settings.role` mora numa tabela que o próprio usuário pode atualizar** → um trigger
(`guard_role_self_escalation`) impede que ele mude `role`, saldo ou os ids de identidade. Sem esse
trigger, a política de update seria um caminho de **auto-promoção a Curador**. `auth.uid()` é NULL na
service role, que passa direto.

O catálogo **não tem política**: é lido/escrito pela service role, que ignora RLS.

`works.ai_eval_status`: `"pending"` (never evaluated / needs AI run) | `"review_pending"` (AI completed / needs review) | `"done"` (accepted/saved) | `"skipped"`.
`ai_evaluations.status`: `"processing"` | `"completed"` | `"failed"` (separate from the work status).

`category_scores.source`: `"manual"` | `"imported"` | `"ai_accepted"` | `"ai_edited"`.

## Tests

`npm run test` → **2.386 passando (+24 pulados) em 221 arquivos** (medido em 2026-08-09; a
linha já dizia "~1.780 em ~157" e depois "~2.353 em 218", as duas envelhecendo sem nada
acusar — **re-meça antes de editar este número**). Vitest, jsdom, alias `@` → raiz. A
descrição antiga ("só `tests/unit/calculations/`, sem teste de componente") estava desatualizada
havia muito: hoje `calculations` é a 4ª maior pasta, atrás de `synopsis-interest` (36),
`external` (30) e `orchestration` (19), e há `.test.tsx` de componente.

⚠️ **Sob carga, a suíte FALHA sem nenhum teste falhar.** Com dev server + Supabase local +
Chromium abertos, o pool de forks estoura timeout ao subir workers
(`[vitest-pool-runner]: Timeout waiting for worker to respond`) e alguns arquivos simplesmente
não rodam. Medido em 2026-08-09: **9 arquivos numa execução, 7 arquivos DIFERENTES na seguinte**
— o conjunto é aleatório, e o rodapé ainda diz "0 failed". Antes de chamar de verde, re-rode os
acusados isolados (`npx vitest run --maxWorkers=2 <arquivos>`); se passarem, era a máquina.

⚠️ **O Vitest NÃO faz checagem completa de tipos do projeto.** Suíte verde não garante que
compila — quem responde isso é `npm run build`. Rode-o antes de abrir PR que mexa em tipos
compartilhados. (E `next build` disputa o `.next` com o `next dev`: pare o dev antes.)

Vale conhecer `tests/unit/orchestration/`: além de unidade, ele guarda **testes de arquitetura**
que varrem o source e falham quando uma invariante é violada — ex.: só o runner da fila pode
importar `recalculateAll`; os leitores per-usuário não podem usar `getCurrentUserId()`. Servem
pra classe de erro que não quebra build nem runtime, só serve o dado errado.
