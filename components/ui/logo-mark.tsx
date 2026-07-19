/* eslint-disable @next/next/no-img-element -- logo local estático (asset fixo em /public); next/image não agrega otimização aqui e exigiria config extra. Ponto único de <img> da marca. */

import { cn } from "@/lib/utils"

/**
 * Símbolo (badge) do SatorIA — lótus/bússola. Imagem única reutilizada na sidebar,
 * na tela de login e na de cadastro. O PNG já vem com cantos arredondados e
 * transparentes e fundo próprio, então funciona em qualquer superfície (tema
 * claro ou escuro) sem container de fundo. Server- e client-safe (sem hooks).
 */
export function LogoMark({ className, alt = "SatorIA" }: { className?: string; alt?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt={alt}
      width={40}
      height={40}
      decoding="async"
      className={cn("block object-contain", className)}
    />
  )
}
