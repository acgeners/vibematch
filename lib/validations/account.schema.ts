import { z } from "zod"
import { isValidAvatarUrl } from "@/lib/avatar/url"

// Campos do perfil editável em /account. Todos são strings no form (inputs de
// texto): vazio é permitido; quando preenchido, email/URL precisam ser válidos.
// A conversão "" → null (pra não gravar "" no banco) é feita no server action.
export const accountProfileSchema = z.object({
  displayName: z.string().trim().max(80, "Nome muito longo (máx. 80)."),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Email inválido."),
  // ⚠️ Não é mais um campo digitável — quem escreve aqui é o painel de avatar ou o
  // upload. A validação FICA porque toda export de um arquivo "use server" é endpoint
  // HTTP público: tirar o input da tela não fecha a porta. `isValidAvatarUrl` é o dono
  // único das três formas aceitas (vazio, `/avatar.svg?…`, URL absoluta) — checar
  // "é URL?" aqui recusaria o avatar montado, que é um caminho relativo.
  avatarUrl: z.string().trim().max(2048).refine(isValidAvatarUrl, "Avatar inválido."),
})

export type AccountProfileValues = z.infer<typeof accountProfileSchema>
