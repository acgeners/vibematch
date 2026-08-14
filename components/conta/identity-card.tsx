"use client"

import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AvatarPicker } from "@/components/conta/avatar-picker"
import { refreshChrome } from "@/lib/chrome-refresh"
import { accountProfileSchema } from "@/lib/validations/account.schema"
import type { AccountProfileValues } from "@/lib/validations/account.schema"
import { updateProfile } from "@/server/actions/account"

interface IdentityCardProps {
  userId: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
}

export function IdentityCard({ userId, displayName, email, avatarUrl }: IdentityCardProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AccountProfileValues>({
    resolver: zodResolver(accountProfileSchema),
    defaultValues: {
      displayName: displayName ?? "",
      email: email ?? "",
      avatarUrl: avatarUrl ?? "",
    },
  })

  const avatarUrlAtual = (useWatch({ control, name: "avatarUrl" }) ?? "").trim()

  const onSubmit = async (values: AccountProfileValues) => {
    const result = await updateProfile(values)
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    // reset com os valores normalizados ("" pra manter o form controlado).
    reset({
      displayName: values.displayName ?? "",
      email: values.email ?? "",
      avatarUrl: values.avatarUrl ?? "",
    })
    // O chip do topo busca o resumo no cliente (`useChromeData`), então `revalidatePath`
    // sozinho não o atualiza — sem isto, o avatar novo só apareceria na navegação
    // seguinte, e a pessoa acha que não salvou.
    refreshChrome()
    toast.success("Perfil salvo.")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Identidade</CardTitle>
        <CardDescription className="text-xs">
          Nome, email e avatar — o avatar é o que aparece no canto superior direito.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* O painel escreve no MESMO campo do form (`avatarUrl`) que o Salvar envia:
              montado e enviado terminam numa string só, e não há um segundo lugar
              guardando "qual era a configuração". */}
          <AvatarPicker
            value={avatarUrlAtual}
            onChange={(url) =>
              setValue("avatarUrl", url, { shouldDirty: true, shouldValidate: true })
            }
          />

          {/* Campos */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Nome</Label>
              <Input
                id="displayName"
                placeholder="Seu nome"
                aria-invalid={!!errors.displayName}
                {...register("displayName")}
              />
              {errors.displayName && (
                <p className="text-xs text-destructive">{errors.displayName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="voce@exemplo.com"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
          </div>

          {/* 🔴 O campo de texto "URL da imagem" SAIU. Era a terceira forma de definir a
              mesma coisa, e foi por ela que o avatar do dono virou um ponteiro para um
              projeto Supabase extinto — sem nada acusando, porque o `onError` do `<img>`
              caía no ícone padrão em silêncio. O erro do schema continua sendo exibido:
              a action é endpoint público e pode recusar um valor que a tela não digitou. */}
          {errors.avatarUrl && (
            <p className="text-xs text-destructive">{errors.avatarUrl.message}</p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="break-all font-mono text-[11px] text-muted-foreground">
              <span className="text-muted-foreground/70">user id:</span> {userId}
            </p>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
