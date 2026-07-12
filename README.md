# SatorIA

> Seu catálogo de manhwas/mangás com uma IA que aprende o seu gosto e prevê o que você vai amar ler.

Aplicação Next.js que cataloga obras, busca metadados em múltiplas fontes externas,
avalia cada obra por critérios via Claude e prevê a nota que **você** daria (a "Nota Prevista"),
alimentando ranking e recomendações personalizadas.

## Stack

- **Next.js 16** (App Router + Turbopack), React 19, TypeScript, Tailwind 4, Radix UI
- **Supabase** (Postgres) — todo acesso é server-only via service role (`createAdminClient()`); RLS ligado sem políticas permissivas. Não há camada de auth ainda (multi-user em preparação).
- **Claude** (`@anthropic-ai/sdk`) — avaliação por critérios + perfil de gosto + chat de recomendação, com cache L1/L2 e prompt caching.
- **Fontes externas** — AniList, MangaUpdates, ComicK, Kitsu, MyAnimeList, MangaDex, AnimePlanet e Comix (este via FlareSolverr, por causa do Cloudflare).
- **Vitest** — testes unitários do pipeline de notas (`tests/unit/calculations/`).

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha as chaves (Supabase + Anthropic)
npm run dev                  # http://localhost:3001  (porta 3001, não 3000)
```

As variáveis necessárias estão em [`.env.example`](.env.example) — destaque para
`SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY`.

### `MAL_CLIENT_ID` — MyAnimeList

Os metadados do MAL (nota, votos, capítulos, status, sinopse) vêm da **API oficial v2**,
que exige um Client ID no header `X-MAL-CLIENT-ID`. Registre um app em
[myanimelist.net/apiconfig](https://myanimelist.net/apiconfig) (grátis; tipo `other`) e
ponha o **Client ID** — só ele — em `MAL_CLIENT_ID`.

O **Client Secret não vai no `.env`**: ele só serve pro fluxo OAuth (dados de usuário
logado), que o app não usa. Um segredo guardado sem uso é só mais uma coisa pra vazar.

Sem a variável, o MAL degrada em silêncio: some da busca e não entra na média de
plataforma — e ele costuma ser a fonte com **mais votos** de todas (em "Solo Leveling",
371 mil, contra 121 mil do AniList), então a nota prevista sente a falta.

## Comandos

```bash
npm run dev             # dev server em http://localhost:3001
npm run build           # build de produção
npm run test            # vitest run (todos os testes)
npm run test:watch      # vitest em watch
npm run lint            # eslint
npm run sync-constants  # regenera os arquivos de constantes a partir do Supabase (requer SUPABASE_SERVICE_ROLE_KEY)
npm run resolve-comix-hids  # resolve os hids do Comix (usa Chrome/puppeteer-core)
```

> `sync-constants` **sobrescreve** 7 arquivos gerados — nunca edite à mão os listados em CLAUDE.md.

## Estrutura & arquitetura

A referência viva de arquitetura, pipeline de notas, fluxos de avaliação IA e fontes
externas está em [CLAUDE.md](CLAUDE.md). O roadmap e o estado de implementação estão
em [PLANO.md](PLANO.md). O guia de deploy (Fly.io) está em [DEPLOY-FLY.md](DEPLOY-FLY.md).

```
app/          rotas (server components por padrão)
components/   componentes React ("use client" nas folhas interativas)
server/       actions ("use server") + queries (leitura server-only)
lib/          ai-evaluation, ai-recommendation, calculations, external, ml, supabase…
supabase/     histórico de migrations SQL
```
