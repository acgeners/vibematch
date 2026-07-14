# Suítes de DOIS USUÁRIOS

As seis suítes que sustentaram a Fase 2 (multi-user). **Cada bug sério da Fase 2 foi pego por
uma delas, não por leitura de código** — e vários passaram pelo `tsc`, pelo lint e pelos 1467
testes unitários sem um arranhão.

## Como rodar

```bash
npm run dev                                     # precisa do app em pé (:3001)
node scripts/e2e/verify-fatia1.mjs              # acompanhamento: favorito, status, capítulo
node scripts/e2e/verify-reads.mjs               # /leitura, /favoritos, home — cada um vê o seu
node scripts/e2e/verify-fatia2a.mjs             # nota, ♥, anotações, pós-leitura
node scripts/e2e/verify-writers.mjs             # o espelho não apodrece (882 obras, 0 divergências)
node scripts/e2e/verify-2b-reads.mjs            # a Nota Prevista do dono não vaza
node scripts/e2e/verify-free-produto.mjs        # grupos dela, obra dela, ZERO token
```

Todas **limpam o que escrevem** e são idempotentes.

## Por que elas pegam o que os testes unitários não pegam

**Elas não confiam na UI.** Botão escondido não prova nada: toda função exportada de um
`"use server"` é um **endpoint HTTP público**. As suítes extraem o `Next-Action` id **do bundle
do cliente** (é assim que um atacante o obteria) e chamam a server action **direto**.

**Elas usam sessões reais** — magic link → `verifyOtp` → cookies montados pelo próprio
`@supabase/ssr`. Nenhuma senha é tocada. Craftar o cookie "na mão" seria testar a minha
suposição sobre o formato, não o app.

**E o juiz é o banco**, não a resposta da action: depois de cada chamada, elas conferem
`works` × `user_work_state` × `calculated_scores` com a service role.

## Armadilhas que estas suítes já pegaram (não repita)

- **`verify-reads` acusou "vazamento"** que era o widget de catálogo (obras top da comunidade
  aparecem pra todo mundo — não é o estado dele). **Um probe que acusa demais some no ruído.**
- **`verify-2b-reads` procurava o score da obra no payload** — mas ali só vêm os das obras
  SIMILARES. O probe "errado" foi o que revelou o vazamento real.
- **`verify-free-produto` bateu no endpoint errado** (`createWorkPending`, que é código morto),
  tomou 404 e **"passou"** porque a resposta não continha "Só o Curador".
  **Assert por AUSÊNCIA de string é frágil** — prefira exigir o efeito no banco.

## Os dois usuários

Saem do **banco em tempo de execução** (`_users.mjs`): o **dono** é a linha singleton de
`user_settings` (a mais antiga — o mesmo critério do app), e "a outra" é qualquer não-dono.

⚠️ **Nunca hardcode e-mail aqui.** Este repositório é **público**, e e-mail de usuário real é
dado pessoal — não entra em código, nem em comentário, nem em mensagem de commit. (A primeira
versão destes scripts tinha os dois e-mails escritos no arquivo; o guarda-corpo do harness
barrou o push, e estava certo.)
