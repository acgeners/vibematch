# Fluxo de Git Worktrees — animedb

Referência rápida pro fluxo de trabalho em paralelo com worktrees, Antigravity IDE e Claude Code.

---

## Conceitos rápidos

- **Worktree** = pasta separada apontando pro mesmo repositório Git, em uma branch diferente. Permite trabalhar em várias branches ao mesmo tempo, sem ficar trocando de branch na mesma pasta.
- **Branch ≠ Pasta**. A pasta é onde os arquivos vivem no disco. A branch é o "rótulo" que o Git dá pra aquela versão do código. Pra ver a branch atual de um worktree: `git branch --show-current`.
- **Commit ≠ Push**. Commit é local (registra um checkpoint na sua máquina). Push é remoto (manda os commits pro GitHub).
- **Push ≠ PR**. Push só envia a branch pro GitHub. PR (Pull Request) é o pedido formal pra mergear essa branch em outra (geralmente na `main`).

---

## Estrutura de pastas

```
~/Code/VibeMatch/
├── animedb/                  ← worktree principal, sempre na main
├── animedb-FEATURE/          ← worktree de feature, criado conforme necessidade
└── animedb-integracao/       ← worktree de integração, quando há múltiplas features pra juntar
```

**Convenção:** nome da pasta espelha o nome da branch (trocando `/` por `-`).

| Pasta | Branch |
|---|---|
| `animedb-layout` | `feat/layout` |
| `animedb-logica` | `feat/logica` |
| `animedb-fix-login` | `fix/login` |
| `animedb-integracao` | `test/integracao` ou `integration/iter-N` |

---

## O ciclo completo de uma iteração

### Fase 1 — Começar (main limpa)

```bash
cd ~/Code/VibeMatch/animedb
git checkout main
git pull                    # atualiza main local com o GitHub
git status                  # confere: "nothing to commit, working tree clean"
```

### Fase 2 — Criar worktrees pras features

```bash
git worktree add ../animedb-FEATURE1 -b feat/feature1
git worktree add ../animedb-FEATURE2 -b feat/feature2
```

Em cada worktree novo:

```bash
cd ../animedb-FEATURE1
npm install
cp ../animedb/.env.local .
```

Abre cada pasta como uma janela do Antigravity (`File → New Window` → `File → Open Folder`).

### Fase 3 — Trabalhar

Em cada worktree, durante o trabalho:

```bash
git add .
git commit -m "feat(área): descrição clara"
```

Commita várias vezes ao dia, sempre que completar uma mudança coerente.

Push pra backup (ao fim do dia, ou periodicamente):

```bash
git push -u origin feat/feature1   # primeira vez
git push                            # próximas vezes
```

### Fase 4 — Integrar localmente (quando features podem conflitar)

```bash
cd ~/Code/VibeMatch/animedb
git checkout main
git pull
git worktree add ../animedb-integracao -b test/integracao
cd ../animedb-integracao
npm install
cp ../animedb/.env.local .

git merge feat/feature1
git merge feat/feature2     # se aparecer conflito, resolve (ver seção "Conflitos")
```

### Fase 5 — Testar local

```bash
npm run dev
```

Testa tudo no navegador. Se quebrar, volta nas branches origem, conserta, refaz o merge.

### Fase 6 — Push e PR no GitHub

```bash
git push -u origin test/integracao
```

No GitHub:
1. Abre o PR (`base: main` ← `compare: test/integracao`)
2. Coloca título descritivo (não `Test/integracao`, algo tipo "Iteração 1: feature X + Y")
3. Escreve descrição com bullets do que mudou
4. **Files changed**: revisa o diff
5. **Merge pull request** → setinha → **Squash and merge** → **Confirm**
6. **Delete branch** no GitHub

### Fase 7 — Atualiza main local

```bash
cd ~/Code/VibeMatch/animedb
git checkout main
git pull        # puxa o merge do GitHub
npm run dev     # testa que tudo funciona na main "oficial"
```

### Fase 8 — Limpeza

```bash
# para o servidor com Ctrl+C antes

git worktree remove --force ../animedb-FEATURE1
git worktree remove --force ../animedb-FEATURE2
git worktree remove --force ../animedb-integracao

git branch -D feat/feature1
git branch -D feat/feature2
git branch -D test/integracao

# se as remotas ainda existirem (não deletadas pelo botão do GitHub):
git push origin --delete feat/feature1
git push origin --delete feat/feature2

git fetch --prune
```

Fecha as janelas do Antigravity dos worktrees removidos (`Cmd + W`).

### Fase 9 — Confere estado limpo

```bash
git worktree list   # SÓ animedb na main
git branch          # SÓ * main
git status          # nothing to commit, working tree clean
```

Pronto pra próxima iteração. Volta na Fase 1.

---

## Comandos de consulta (uso frequente)

```bash
git worktree list             # lista todos os worktrees
git branch                    # lista branches locais
git branch --show-current     # mostra branch atual do worktree atual
git status                    # estado do worktree atual
git log --oneline -10         # últimos 10 commits da branch atual
```

---

## Resolvendo conflitos no merge

Quando `git merge` para com conflito, o terminal lista os arquivos:

```
CONFLICT (content): Merge conflict in caminho/do/arquivo.tsx
```

Pra cada arquivo conflitado:

1. Abre o arquivo no editor
2. `Cmd + F` → busca `<<<<<<<` → Enter
3. Você vai ver blocos assim:

```
<<<<<<< HEAD
código da branch atual (já mergeada antes)
=======
código da branch sendo mergeada agora
>>>>>>> nome/da/branch
```

4. Decide o que fica (uma versão, a outra, ou combinação)
5. **Apaga as marcações** `<<<<<<<`, `=======`, `>>>>>>>` — o arquivo final fica só com código limpo
6. Repete pra cada conflito do arquivo
7. Repete pra cada arquivo conflitado

Quando terminar:

```bash
git add .
git status              # confere "All conflicts fixed"
git commit              # finaliza o merge (abre editor com msg padrão, salva e sai)
```

**Se ficar perdida no meio:**

```bash
git merge --abort       # cancela o merge, volta ao estado anterior
```

**Dica:** peça ajuda pro Claude Code no Antigravity: "Estou resolvendo conflito de merge entre feat/X e feat/Y em [arquivo]. Lê os dois lados do conflito, entende o que cada um quer fazer, e me sugere a resolução."

---

## Pegadinhas comuns (que já aconteceram)

### "fatal: a branch named 'X' already exists"

A branch já existe (provavelmente de tentativa anterior). Apaga e recria:

```bash
git branch -D feat/X
git worktree add ../animedb-X -b feat/X
```

### "Error: listen EADDRINUSE: address already in use :::3001"

A porta está ocupada por outro processo. Opções:

```bash
# ver quem está usando
lsof -i :3001

# matar o processo
lsof -ti :3001 | xargs kill

# OU subir em outra porta (ignora o script package.json):
npx next dev --port 3002
```

### `PORT=XXXX npm run dev` não respeita a variável

Significa que o script do `package.json` tem a porta hardcoded (`next dev --port 3001`). Use:

```bash
npx next dev --port XXXX
```

### `git branch -d` recusa apagar branch

O `-d` minúsculo só apaga branches já mergeadas. Se a branch foi mergeada via **squash**, o Git não reconhece como mergeada (hashes diferentes). Use:

```bash
git branch -D feat/X    # maiúsculo: força
```

### `src refspec X does not match any` no push

Você está pushando uma branch que não existe. Confirme o nome:

```bash
git branch --show-current
```

E pusha com o nome correto.

### `git worktree remove` reclama de "modified or untracked files"

O worktree tem arquivos não rastreados (geralmente `node_modules`). Force:

```bash
git worktree remove --force ../animedb-X
```

### Comentários (`#`) em comandos do terminal

Não funcionam bem quando coladas várias linhas de uma vez. Roda um comando por linha, sem comentários, se der problema.

### Comentários sobre o `cp ../animedb/.env.local .`

O comando não fala nada quando dá certo. Pra confirmar que copiou:

```bash
ls -la .env.local
```

---

## Sub-fluxo alternativo: Features independentes (sem branch de integração)

Quando as features são bem isoladas e você confia que não vão conflitar:

```
main → feat/A + feat/B → PR de A → merge → rebase B em main → PR de B → merge
```

Vantagem: PR por feature, histórico mais granular.
Desvantagem: só testa a integração após cada merge na main.

**Rebase da segunda branch após o primeiro merge:**

```bash
cd ../animedb-FEATURE2
git fetch
git rebase main
# se conflito: resolve, git add ., git rebase --continue
git push --force-with-lease     # rebase reescreve histórico
```

---

## Tipos de merge no GitHub (escolha pelo botão "Merge pull request")

- **Squash and merge** (recomendado pro seu caso): junta todos os commits da branch num único commit na main. Histórico limpo.
- **Create a merge commit** (padrão): mantém todos os commits + cria commit de merge. Histórico fiel mas verboso.
- **Rebase and merge**: aplica os commits da branch na main sem commit de merge. Histórico linear.

---

## Quando rodar `npm run dev` em paralelo

Cada worktree tem seu próprio `npm run dev`. Pra evitar conflito de porta:

```bash
# no worktree de layout
npx next dev --port 3001

# no worktree de lógica
npx next dev --port 3002

# no worktree de integração
npx next dev --port 3003
```

**Dica:** não precisa rodar dev em todos. Mantém rodando só no worktree em que você está editando visualmente. Os outros sobe sob demanda.

---

## Boas práticas

1. **Nunca trabalhe direto na `main`.** Sempre cria uma branch via worktree, mesmo pra "correções pequenas".
2. **Commita cedo e com frequência.** Cada interação com o agente que dá certo, commita.
3. **`git pull` antes de criar worktree novo.** Senão você nasce desatualizada.
4. **Limpa worktrees logo após o merge.** Cada `node_modules` come ~500MB.
5. **2 ou 3 worktrees paralelos é o limite cognitivo.** Mais que isso vira caos.
6. **Mensagens de commit descritivas.** `feat(layout): refatora work-compare-drawer` > `ajustes`.
7. **Sempre PR, nunca push direto na main.** Cria histórico, permite revisão, reversível.
8. **Squash and merge** pra manter a main com histórico limpo.

---

## Comandos pra ter sempre na cabeça

```bash
# começar iteração
git checkout main && git pull
git worktree add ../animedb-X -b feat/x

# trabalhar
git add . && git commit -m "..."
git push

# integrar (se múltiplas features)
git worktree add ../animedb-integracao -b test/integracao
git merge feat/x
git merge feat/y

# finalizar
git push -u origin <branch>
# PR no GitHub → squash and merge

# limpar
git worktree remove --force ../pasta
git branch -D nome/branch
git push origin --delete nome/branch
git fetch --prune
```
