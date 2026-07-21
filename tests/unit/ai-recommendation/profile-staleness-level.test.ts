import { describe, it, expect } from "vitest"

import {
  classifyProfileStalenessLevel,
  profileStalenessTriggers,
  PROFILE_DRIFT_REGEN_THRESHOLD,
  PROFILE_DRIFT_THRESHOLD,
  PROFILE_STALE_AGE_DAYS,
  PROFILE_STALE_FRACTION_NEW,
} from "@/lib/ai-recommendation/profile-staleness"
import type { ProfileStaleness } from "@/lib/ai-recommendation/profile-staleness"

const st = (over: Partial<ProfileStaleness> = {}): ProfileStaleness => ({
  stale: false,
  reason: "fresh",
  driftPct: 0,
  changedTags: 0,
  lovedJaccard: 1,
  avoidedJaccard: 1,
  fractionNew: 0,
  ageDays: 0,
  ...over,
})

describe("classifyProfileStalenessLevel — a escada de exibição", () => {
  it("perfil recém-gerado → fresh", () => {
    expect(classifyProfileStalenessLevel(st())).toBe("fresh")
  })

  it("drift abaixo da metade do θ ainda é fresh", () => {
    expect(classifyProfileStalenessLevel(st({ driftPct: PROFILE_DRIFT_THRESHOLD * 0.49 }))).toBe(
      "fresh",
    )
  })

  it("metade do θ liga o aviso precoce, SEM marcar stale", () => {
    const s = st({ driftPct: PROFILE_DRIFT_THRESHOLD * 0.5 })
    expect(classifyProfileStalenessLevel(s)).toBe("moving")
    // O gate de dinheiro não muda: `moving` é puramente cosmético.
    expect(s.stale).toBe(false)
  })

  it("metade da fração de obras novas também liga o aviso precoce", () => {
    expect(
      classifyProfileStalenessLevel(st({ fractionNew: PROFILE_STALE_FRACTION_NEW * 0.5 })),
    ).toBe("moving")
  })

  it("metade da idade também liga o aviso precoce", () => {
    expect(classifyProfileStalenessLevel(st({ ageDays: PROFILE_STALE_AGE_DAYS * 0.5 }))).toBe(
      "moving",
    )
  })

  it("gate disparado (stale) → stale, mesmo com drift zero (marcado por idade)", () => {
    expect(
      classifyProfileStalenessLevel(
        st({ stale: true, reason: "age", ageDays: PROFILE_STALE_AGE_DAYS }),
      ),
    ).toBe("stale")
  })

  it("drift no patamar de regeneração → severe, e severe vence stale", () => {
    const s = st({ stale: true, reason: "drift", driftPct: PROFILE_DRIFT_REGEN_THRESHOLD })
    expect(classifyProfileStalenessLevel(s)).toBe("severe")
  })

  it("perfil legado sem fingerprint (stale por input_hash, drift 0) → stale, nunca severe", () => {
    // Se caísse em `severe`, um perfil pré-migration 118 empurraria o usuário pro
    // gasto sem nenhuma evidência de que o gosto se moveu.
    expect(classifyProfileStalenessLevel(st({ stale: true, reason: "legacy_hash" }))).toBe("stale")
  })
})

describe("profileStalenessTriggers — qual dos três gatilhos acendeu", () => {
  it("nenhum gatilho num perfil em dia", () => {
    expect(profileStalenessTriggers(st())).toEqual({ drift: false, fractionNew: false, age: false })
  })

  it("acende só o drift quando foi ele que marcou", () => {
    expect(profileStalenessTriggers(st({ stale: true, driftPct: PROFILE_DRIFT_THRESHOLD }))).toEqual(
      { drift: true, fractionNew: false, age: false },
    )
  })

  it("acende só a idade quando o perfil ficou velho sem o gosto mudar", () => {
    // É este caso que justifica os chips: a barra de drift fica perto de zero e,
    // sem eles, o alerta pareceria não ter causa.
    expect(
      profileStalenessTriggers(st({ stale: true, ageDays: PROFILE_STALE_AGE_DAYS, driftPct: 0.01 })),
    ).toEqual({ drift: false, fractionNew: false, age: true })
  })

  it("acende os três quando todos estouram", () => {
    expect(
      profileStalenessTriggers(
        st({
          stale: true,
          driftPct: 0.5,
          fractionNew: 0.4,
          ageDays: PROFILE_STALE_AGE_DAYS + 10,
        }),
      ),
    ).toEqual({ drift: true, fractionNew: true, age: true })
  })

  it("idade nula (perfil sem created_at) não acende o gatilho de idade", () => {
    expect(profileStalenessTriggers(st({ ageDays: null })).age).toBe(false)
  })
})
