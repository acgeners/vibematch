"use client"

/* eslint-disable @next/next/no-img-element -- avatar com URLs externas variadas + fallback próprio; next/image não cabe (sem images config). */

import { useRef, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { UserCircle, Upload, Loader2 } from "lucide-react"
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
import { accountProfileSchema } from "@/lib/validations/account.schema"
import type { AccountProfileValues } from "@/lib/validations/account.schema"
import { updateProfile, uploadAvatar } from "@/server/actions/account"

interface IdentityCardProps {
  userId: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
}

export function IdentityCard({ userId, displayName, email, avatarUrl }: IdentityCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

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

  // Preview ao vivo: segue o campo de URL (colado ou preenchido pelo upload).
  const previewUrl = (useWatch({ control, name: "avatarUrl" }) ?? "").trim()

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
    toast.success("Perfil salvo.")
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // permite reescolher o mesmo arquivo depois
    if (!file) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const result = await uploadAvatar(fd)
      if (result.error || !result.url) {
        toast.error(`Erro no upload: ${result.error ?? "URL ausente"}`)
        return
      }
      // O upload já gravou avatar_url no banco; refletimos no campo (marca dirty=false
      // pra essa parte, mas Salvar continua disponível pra nome/email).
      setValue("avatarUrl", result.url, { shouldDirty: true, shouldValidate: true })
      toast.success("Imagem enviada.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Identidade</CardTitle>
        <CardDescription className="text-xs">
          Nome, email e avatar. Enquanto o login não entra, ficam salvos no seu perfil.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20 [&_svg]:size-8">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Avatar"
                  className="size-full object-cover"
                  onError={(ev) => {
                    // URL morta: esconde a img pra cair no fundo gradiente.
                    ev.currentTarget.style.display = "none"
                  }}
                />
              ) : (
                <UserCircle />
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onPickFile}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {uploading ? "Enviando..." : "Enviar imagem"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                PNG, JPG, WEBP ou GIF até 2 MB — ou cole uma URL abaixo.
              </p>
            </div>
          </div>

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

          <div className="space-y-1.5">
            <Label htmlFor="avatarUrl">URL da imagem</Label>
            <Input
              id="avatarUrl"
              placeholder="https://..."
              aria-invalid={!!errors.avatarUrl}
              {...register("avatarUrl")}
            />
            {errors.avatarUrl && (
              <p className="text-xs text-destructive">{errors.avatarUrl.message}</p>
            )}
          </div>

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
