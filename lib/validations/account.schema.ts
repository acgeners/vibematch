import { z } from "zod"

// Campos do perfil editável em /conta. Todos são strings no form (inputs de
// texto): vazio é permitido; quando preenchido, email/URL precisam ser válidos.
// A conversão "" → null (pra não gravar "" no banco) é feita no server action.
export const accountProfileSchema = z.object({
  displayName: z.string().trim().max(80, "Nome muito longo (máx. 80)."),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Email inválido."),
  avatarUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === "" || z.string().url().safeParse(v).success, "URL inválida."),
})

export type AccountProfileValues = z.infer<typeof accountProfileSchema>
