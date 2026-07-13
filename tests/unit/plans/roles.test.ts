import { describe, it, expect } from "vitest"
import {
  roleAtLeast,
  roleAllows,
  isRole,
  deniedMessage,
  PERMISSIONS,
  ROLE_LABELS,
} from "@/lib/plans/roles"
import type { Role, Permission } from "@/lib/plans/roles"

const ROLES: Role[] = ["leitor", "assinante", "curador"]

describe("escada de papéis", () => {
  it("leitor < assinante < curador", () => {
    expect(roleAtLeast("curador", "assinante")).toBe(true)
    expect(roleAtLeast("curador", "leitor")).toBe(true)
    expect(roleAtLeast("assinante", "leitor")).toBe(true)

    expect(roleAtLeast("assinante", "curador")).toBe(false)
    expect(roleAtLeast("leitor", "assinante")).toBe(false)
    expect(roleAtLeast("leitor", "curador")).toBe(false)
  })

  it("todo papel satisfaz a si mesmo (a escada é ≥, não >)", () => {
    for (const r of ROLES) expect(roleAtLeast(r, r)).toBe(true)
  })

  it("isRole rejeita o vocabulário antigo — nada de free/paid/admin virando papel", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true)
    for (const v of ["free", "paid", "admin", "Curador", "", null, undefined, 2]) {
      expect(isRole(v)).toBe(false)
    }
  })
})

describe("permissões por papel", () => {
  it("o CURADOR pode tudo — nenhuma permissão fica fora do dono", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(roleAllows("curador", p)).toBe(true)
    }
  })

  it("o LEITOR só pode escrever o PRÓPRIO estado — nada do catálogo, nada de IA", () => {
    // `own_state` é o único verbo do leitor: favoritar, status, capítulo lido, nota. É o
    // que o faz deixar de ser um espectador. (Enquanto a Fase 2 não parte `works`, esse
    // estado mora na linha COMPARTILHADA e os writers seguem em `curate_work` — o verbo
    // existe, mas ainda não tem onde escrever. Ver PLANO-MULTIUSER-FASE2.md §2.)
    expect(roleAllows("leitor", "own_state")).toBe(true)

    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      if (p === "own_state") continue
      expect(roleAllows("leitor", p)).toBe(false)
    }
  })

  it("ASSINANTE: atualiza obra e consome IA, mas NÃO cura", () => {
    // O que ele paga pra ter:
    expect(roleAllows("assinante", "refresh_work")).toBe(true)
    expect(roleAllows("assinante", "consume_ai")).toBe(true)

    // A fronteira que não pode vazar: `works` é COMPARTILHADA (sem user_id), então
    // curar = decidir pelos outros. Se algum destes virar true, o assinante passa a
    // poder degradar o catálogo do curador — e não há reversão por usuário.
    expect(roleAllows("assinante", "curate_work")).toBe(false)
    expect(roleAllows("assinante", "curate_ai")).toBe(false)
    expect(roleAllows("assinante", "global_config")).toBe(false)
  })

  it("atualizar ≠ curar: a distinção existe de fato na tabela de permissões", () => {
    expect(PERMISSIONS.refresh_work).toBe("assinante")
    expect(PERMISSIONS.curate_work).toBe("curador")
  })
})

describe("mensagens de bloqueio", () => {
  it("dizem o que falta, não só que negou", () => {
    expect(deniedMessage("curate_work")).toContain("Curador")
    expect(deniedMessage("refresh_work")).toContain(ROLE_LABELS.assinante)
  })
})
