import { PERSONAL_STATUSES_BY_ID } from "./criteria"

/**
 * Descrição em PT de cada status pessoal — vem do Supabase (`personal_status.description_pt`,
 * migration 157), gerada por `sync-constants`.
 *
 * Aqui havia um dicionário escrito à mão, e ele estava morto sem ninguém notar:
 *   · tinha `Completed` (o status virou "Finished" — a entrada nunca mais casava)
 *   · tinha `Paused`, um status que NUNCA existiu na tabela
 *   · não tinha `Finished`, `Read Again`, `Not Now` nem `Untracked`
 *
 * E a função priorizava o `comment` do Supabase, que está em INGLÊS ("Finished reading") — então
 * o tooltip mostrava inglês sempre que o comment existia, e português só quando ele estava vazio.
 * Agora a descrição voltada ao usuário tem coluna própria (`description_pt`), preenchida para os
 * 11 status, e o `comment` volta a ser o que sempre foi: nota interna.
 */
const DESCRIPTION_BY_STATUS = new Map<string, string>(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.descriptionPt]),
)

/**
 * Descrição do status pessoal para tooltip.
 *
 * `comment` continua aceito por compatibilidade com os call sites (que o passam vindo de
 * `getStatusOptions`), mas só é usado se a tabela não tiver `description_pt` — o que a migration
 * 157 impede via constraint.
 */
export function getPersonalStatusDescription(
  status: string,
  comment?: string | null
): string {
  return DESCRIPTION_BY_STATUS.get(status)?.trim() || comment?.trim() || ""
}
