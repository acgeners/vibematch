/**
 * O FUNIL de um script de correção — dono único de "quantos candidatos sobraram em cada
 * estágio".
 *
 * ── por que existe ────────────────────────────────────────────────────────────────────────
 *
 * 🔴 **"Nada a fazer" é indistinguível de "está tudo certo".** Foi assim que o `--heal` do
 * `adult-content-retroactive-bounds.ts` ficou INERTE sem nada acusar: o PostgREST devolve
 * embed to-one como objeto, o código fazia `?.[0]`, e o baseline da avaliação não era
 * encontrado em **373 de 392 obras** (95,2%). O script imprimia "nada a gravar" e saía com
 * sucesso. Quem o pegou foi um contador dar 0 onde eu esperava 89 — não um teste, não um log.
 *
 * A régua desta base: **"nada a fazer" precisa provar que OLHOU.** Um estágio que engole os
 * candidatos salta aos olhos quando a cadeia inteira está na tela:
 *
 *     funil: 392 com limite → 19 com avaliação encontrada → 0 a mover
 *            🔴 maior queda em "com avaliação encontrada": 373 de 392 (95%)
 *
 * ── o que ele NÃO faz ─────────────────────────────────────────────────────────────────────
 *
 * ⚠️ Ele não decide se a queda é defeito. Queda de 95% pode ser o normal de um filtro
 * legítimo, e inventar um limiar aqui seria alarme sem distribuição medida — o erro que esta
 * base já nomeou. O que ele garante é que a informação **está na tela no momento em que
 * decide**, em vez de exigir que alguém desconfie primeiro.
 *
 * ⚠️ Por isso `nadaAFazer()` existe e `console.log("nada a corrigir")` não deve mais ser
 * escrito à mão: a frase e a cadeia têm de sair JUNTAS. Separadas, volta a ser possível
 * imprimir a conclusão sem a evidência — que é exatamente o estado que custou o `--heal`.
 */

/** Um passo do funil. `n` é quantos candidatos SOBRARAM depois dele. */
export function criarFunil(titulo = "") {
  const passos = []
  let reprovados = 0

  const cadeia = () => passos.map((p) => `${p.n} ${p.nome}`).join(" → ")

  /**
   * A queda mais suspeita — e "suspeita" tem uma régua, calibrada em TRÊS execuções reais
   * contra a nuvem em 21/08, não deduzida:
   *
   * | funil medido                                    | tem dreno? | por quê |
   * |-------------------------------------------------|-----------|---------|
   * | `392 com limite → 19 com baseline → 0 a mover`  | **sim**   | o 19 não é o resultado: algo o engoliu no meio |
   * | `1020 obras lidas → 0 fora da régua`             | não       | o zero É o resultado (passivo fechado em 18/08) |
   * | `1010 ativas → 0 pendentes → 0 a gravar`         | não       | idem, com um passo redundante depois |
   *
   * 🔴 A régua: **a queda que produz o resultado final é o resultado, não um dreno.** As duas
   * primeiras versões disto erraram — "todo passo" marcava o caso 2, "todo passo menos o
   * último" ainda marcava o caso 3 —, e as duas foram pegas rodando de verdade, não lendo o
   * código. Marcar esses casos é o alarme que sempre toca, que ninguém lê.
   *
   * ⚠️ O preço, declarado: um funil que cai para o valor final e para lá fica não é apontado,
   * mesmo que a queda tenha sido defeito. Para esse caso existe `reterAoMenos`, que é a
   * expectativa ESCRITA por quem conhece o filtro.
   */
  function maiorDreno() {
    const final = passos.length ? passos[passos.length - 1].n : 0
    let pior = null
    for (let i = 1; i < passos.length; i++) {
      // Chegou ao valor final: daqui em diante é resultado, não dreno.
      if (passos[i].n === final) break
      const perdeu = passos[i - 1].n - passos[i].n
      if (perdeu > 0 && (!pior || perdeu > pior.perdeu)) {
        pior = { nome: passos[i].nome, perdeu, de: passos[i - 1].n }
      }
    }
    return pior
  }

  function linhas() {
    const out = [`funil${titulo ? ` (${titulo})` : ""}: ${cadeia()}`]
    const dreno = maiorDreno()
    if (dreno) {
      const pct = Math.round((dreno.perdeu / dreno.de) * 100)
      // 🔴 marca só o dreno que engole quase tudo. O emoji não julga — ele aponta onde olhar
      // primeiro, que é a informação que faltava quando o `--heal` dizia "nada a gravar".
      const marca = pct >= 90 ? "🔴" : "·"
      out.push(`       ${marca} maior queda em "${dreno.nome}": ${dreno.perdeu} de ${dreno.de} (${pct}%)`)
    }
    for (const p of passos.filter((x) => x.reprovado)) {
      out.push(
        `       🔴 "${p.nome}" reteve ${p.retido}% e o script esperava ao menos ${p.esperado}% — ` +
          `o estágio anterior tinha ${p.anterior}`,
      )
    }
    return out
  }

  return {
    /**
     * Registra um estágio. `opts.reterAoMenos` (0..1) DECLARA o que se esperava achar: abaixo
     * disso o passo é marcado e `relatar()` devolve false. É opt-in porque só quem escreveu o
     * filtro sabe o que é normal nele — mas onde é sabido, é o que transforma "eu deveria ter
     * desconfiado" em "o script me disse".
     */
    passo(nome, n, opts = {}) {
      const anterior = passos.length ? passos[passos.length - 1].n : null
      const p = { nome, n }
      if (opts.reterAoMenos != null && anterior != null && anterior > 0) {
        const retido = n / anterior
        if (retido < opts.reterAoMenos) {
          Object.assign(p, {
            reprovado: true,
            retido: Math.round(retido * 100),
            esperado: Math.round(opts.reterAoMenos * 100),
            anterior,
          })
          reprovados++
        }
      }
      passos.push(p)
      return n
    },

    /**
     * Imprime a cadeia. Devolve `false` se algum passo furou o `reterAoMenos` declarado — o
     * caller decide o que fazer (sair 1, abortar o `--execute`, seguir avisando).
     */
    relatar() {
      for (const l of linhas()) console.log(l)
      return reprovados === 0
    },

    /**
     * 🔴 O caminho do plano VAZIO. A frase e a cadeia saem juntas, sempre — é a invariante
     * inteira deste módulo. Um `console.log("nada a corrigir")` solto reintroduz o defeito.
     */
    nadaAFazer(frase = "nada a fazer.") {
      for (const l of linhas()) console.log(l)
      console.log(`${frase} (o funil acima mostra ONDE os candidatos se perderam)`)
      return reprovados === 0
    },

    /** Para teste e para quem quiser montar a própria saída. */
    passos: () => passos.slice(),
    maiorDreno,
  }
}
