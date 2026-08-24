"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { getCurrentUserChrome } from "@/server/actions/admin"
import type { CurrentUserChrome } from "@/server/queries/current-user"
import { useChromeData } from "@/lib/use-refresh"
import { roleAllows } from "@/lib/plans/roles"
import type { Permission, Role } from "@/lib/plans/roles"

// Leva o PAPEL do usuário (migration 140) do servidor pro client, pra esconder o que
// ele não pode fazer. Antes era um booleano `isAdmin`; virou papel porque agora há
// TRÊS níveis — o Assinante vê controles que o Leitor não vê (ex.: "Atualizar dados").
//
// Isto é só a camada de UI. O bloqueio REAL é server-side (`ensurePermission` /
// `ensureAdmin` nas actions) — esconder botão nunca foi proteção: toda server action é
// um endpoint HTTP, chamável por POST com ou sem botão na tela.
//
// O default do CONTEXTO segue fail-closed — ele só é alcançado por quem renderize fora do
// Provider, e aí nenhum controle deve aparecer. Quem está dentro recebe o estado que o
// SERVIDOR resolveu (ver `AdminProvider`), não este.
const RoleContext = createContext<CurrentUserChrome>({ role: "leitor", signedIn: false })

/** Papel do usuário atual. */
export function useRole(): Role {
  return useContext(RoleContext).role
}

/** True quando o papel atual libera a permissão. Prefira isto a comparar papel na mão. */
export function useCan(permission: Permission): boolean {
  return roleAllows(useContext(RoleContext).role, permission)
}

/**
 * True quando o usuário é o Curador (dono do catálogo).
 * Mantido com este nome porque dezenas de componentes já o usam; hoje é DERIVADO do
 * papel. Em código NOVO prefira `useCan(verbo)` — ele diz o que está sendo protegido.
 */
export function useIsAdmin(): boolean {
  return useContext(RoleContext).role === "curador"
}

/** True quando HÁ SESSÃO — qualquer papel. Anônimo é `false`. */
export function useIsSignedIn(): boolean {
  return useContext(RoleContext).signedIn
}

/**
 * True quando o usuário pode escrever o PRÓPRIO estado de leitura (favoritar, status,
 * capítulo lido) — Fatia 1.
 *
 * ⚠️ Precisa de SESSÃO, não só de papel. `own_state` é liberado pro Leitor, e o papel de um
 * anônimo TAMBÉM é `leitor` (fail-closed) — então `useCan("own_state")` sozinho deixaria o
 * coração aparecer pro visitante deslogado, que ao clicar tomaria "Entre na sua conta"
 * (`ensureSignedIn`). O que falta ao anônimo não é permissão, é identidade.
 */
export function useCanWriteOwnState(): boolean {
  const { role, signedIn } = useContext(RoleContext)
  return signedIn && roleAllows(role, "own_state")
}

// TTL longo: o papel só muda em login/logout (que já forçam refresh do chrome) ou numa
// troca de plano. 5 min cobre a reconciliação por navegação.
const ROLE_TTL_MS = 300_000

const mesmo = (a: CurrentUserChrome, b: CurrentUserChrome) =>
  a.role === b.role && a.signedIn === b.signedIn

/**
 * O chrome nasce com o que o SERVIDOR já sabia — não mais como anônimo.
 *
 * 🔴 Ele nascia `ANON` e só aprendia a verdade por Server Action. Medido em 2026-08-23, carga
 * fria do curador: o primeiro paint saía com "Entrar" e nav 0/5, e o chrome autenticado só
 * fechava em **879ms**, no fim de uma cascata de QUATRO actions que o Next serializa. Pior, das
 * duas fontes de `signedIn` uma respondia antes da outra: entre 354ms e 879ms a barra exibia o
 * avatar do usuário logado AO LADO do botão "Entrar" — 525ms de contradição.
 *
 * ⚠️ A informação nunca faltou: o middleware acabara de resolver a sessão e 10 rotas já liam as
 * mesmas primitives. O que faltava era ENTREGAR: o servidor sabia e o cliente perguntava de novo.
 *
 * Quem faz o quê, e é essa divisão que mantém uma autoridade só:
 *   - INICIALIZA: o servidor, via `initial` (`readCurrentUserChrome()` no root layout);
 *   - RECONCILIA: `useChromeData`, no `app:chrome-refresh` (login/logout/troca de plano) e por
 *     navegação, respeitando o TTL;
 *   - CORRIGE: o próprio `initial`, quando o servidor manda VALOR diferente do último que ele
 *     mandou — ver abaixo.
 */
export function AdminProvider({
  children,
  initial,
}: {
  children: ReactNode
  /** Resolvido no servidor. Sem sessão vem `{ leitor, false }`, que é o anônimo correto. */
  initial: CurrentUserChrome
}) {
  const [chrome, setChrome] = useState<CurrentUserChrome>(initial)

  // 🔴 A prop precisa ser adotada quando MUDA, e não é preciosismo: login e logout terminam em
  // `redirect()` de Server Action, que re-renderiza o layout no servidor SEM re-montar este
  // componente — `useState` ignoraria o valor novo. E o `useChromeData` sozinho não cobre:
  // depois do login o `pathname` muda, mas `run(false)` cai no TTL de 5 min iniciado na tela de
  // login e NÃO refaz o fetch. Sem esta adoção, o chrome ficaria anônimo depois de entrar.
  //
  // ⚠️ Comparação por VALOR, com o último valor do servidor semeado em `initial`: sem semear, o
  // ajuste dispararia na própria hidratação (o padrão que já custou caro no colapso da sidebar).
  // E é o SERVIDOR corrigindo o cliente — ele é a autoridade, e o layout é `force-dynamic`,
  // então o valor que chega é sempre fresco, nunca um payload velho sobrescrevendo algo novo.
  const [ultimoDoServidor, setUltimoDoServidor] = useState<CurrentUserChrome>(initial)
  if (!mesmo(initial, ultimoDoServidor)) {
    setUltimoDoServidor(initial)
    setChrome(initial)
  }

  // Só troca o objeto quando o VALOR muda: o poll do chrome devolve um objeto novo a cada
  // 5 min e, como ele é o value do context, uma identidade nova re-renderizaria toda a árvore
  // à toa.
  const onData = useCallback((next: CurrentUserChrome) => {
    setChrome((prev) => (mesmo(prev, next) ? prev : next))
  }, [])

  // 🔴 O TTL vale para quem JÁ está autenticado; anônimo revalida sempre. Medido em
  // 2026-08-24: depois do login o `redirect()` da action navega client-side, e o Router serve
  // o layout que ele guardou na TELA DE LOGIN — onde não havia sessão. A prop nova não chega
  // naquele instante (chega na navegação seguinte, e aí o chrome corrige sozinho), então sem
  // esta linha a barra segue dizendo "Entrar" para quem acabou de entrar, até o TTL de 5 min
  // vencer. O defeito é anterior a este gate e o baseline não o via: ele media carga FRIA, que
  // re-monta tudo.
  //
  // ⚠️ O PREÇO, medido e aceito: a navegação client-side do anônimo passa de 1 para 2 Server
  // Actions (curador e leitor não mudam). É barato porque essa chamada não toca o banco — sem
  // cookie o `getUser()` nem vai à rede, e o anônimo fecha a carga com ZERO leituras de auth.
  // Do outro lado da balança está o login não funcionar, que é o defeito que este eixo ataca.
  // Duvidar do anônimo é o lado seguro: ele é o DEFAULT de quem ainda não sabe.
  //
  // ⚠️ Não é polling: `useChromeData` dispara por NAVEGAÇÃO e por evento, nunca por intervalo.
  // 🔴 `temDadoInicial`: o mount NÃO refaz o que o servidor acabou de entregar. Sem isto o
  // arranjo server-first ficava pela metade — o HTML já vinha certo e o cliente disparava um
  // POST na hidratação só para reconfirmar `{signedIn, role}`.
  //
  // ⚠️ E é ele que faz o login funcionar, por um efeito que só a ablação mostrou. Pular o
  // disparo de montagem deixa `lastFetch` em ZERO; então o primeiro fetch de verdade — o da
  // navegação que o `redirect()` provoca — não cai no TTL, e o chrome se corrige ali. Medido em
  // 2026-08-24: 1º header pós-login já com nav 5/5, contra "não corrige em 6s" antes deste eixo.
  //
  // 🔴 Houve uma versão com TTL assimétrico (anônimo revalidando sempre) para consertar esse
  // mesmo login. Ela FOI REMOVIDA: com `temDadoInicial` no lugar, a re-ablação mostrou o login
  // corrigindo igual sem ela — e ela custava uma Server Action extra em toda navegação anônima.
  // Não reintroduza sem medir de novo; o mecanismo que faz o trabalho é este pulo, não o TTL.
  useChromeData(getCurrentUserChrome, onData, ROLE_TTL_MS, undefined, true)
  return <RoleContext.Provider value={chrome}>{children}</RoleContext.Provider>
}
