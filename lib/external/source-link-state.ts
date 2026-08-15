/**
 * O que uma linha de `work_external_ids` significa. PURO.
 *
 * A semântica é a da **migration 038**, que tornou `external_id` nullable e trouxe
 * `is_rejected` justamente pra distinguir "ainda não olhei" de "olhei e não tem":
 *
 * | estado   | linha                                      | quer dizer |
 * |----------|--------------------------------------------|------------|
 * | `linked` | `external_id` preenchido + `is_rejected=false` | vínculo ativo; reviews e metadados vêm de lá |
 * | `absent` | `is_rejected=true` + `external_id` NULL     | "a obra não existe nessa fonte" — DECIDIDO |
 * | `gap`    | sem linha, ou qualquer outra forma          | nunca avaliado — é o único que é trabalho |
 *
 * 🔴 **Existe porque DOIS lugares classificam a mesma linha**: a fila da aba "Fontes"
 * (`getSourceGapQueue`, todas as fontes) e o card de cobertura do Comix em /settings
 * (`getComixCoverageLists`, só a Comix). Antes eram duas cópias do mesmo `if` — a
 * família de erro mais cara deste projeto: as duas telas falariam da MESMA obra e uma
 * diria "pendente" enquanto a outra diz "resolvida", sem erro e sem log. Uma delas
 * derivar da outra não bastaria; as duas derivam daqui.
 *
 * ⚠️ **Rejeitado COM id volta pra `gap`, e isso é escolha, não descuido.** Descartar um
 * candidato específico ("esse hid é de outra obra") não afirma que a obra não está na
 * fonte — ainda cabe o hid certo. Era o comportamento do card do Comix e vale igual pras
 * outras oito. Medido em 2026-08-15 no clone local: das 7.428 linhas, 7.397 são `linked`
 * e 31 são `absent`; nenhuma linha tem hoje a forma de fronteira.
 */
export type SourceLinkState = "linked" | "absent" | "gap"

export function classifySourceLink(row: {
  external_id: string | null | undefined
  is_rejected: boolean | null | undefined
}): SourceLinkState {
  if (row.external_id && row.is_rejected !== true) return "linked"
  if (row.is_rejected === true && !row.external_id) return "absent"
  return "gap"
}
