import { cn } from "@/lib/utils"

/**
 * Símbolo (badge) do SatorIA — nível "Reduzida" do sistema de marca: ensō + lótus
 * + bead, sobre um tile navy. Vetor inline (SVG), então escala sem perder nitidez e
 * é tematizável. Reutilizado na sidebar, no login e no cadastro.
 *
 * O tile navy é auto-contido (funciona em tema claro ou escuro). Os consumidores
 * aplicam `rounded-*` + `ring` + `shadow` via className; `overflow-hidden` aqui
 * garante que o arredondamento recorte o tile. Server- e client-safe (sem hooks).
 *
 * IDs têm prefixo `satoria-`; como todas as instâncias definem os MESMOS gradientes,
 * uma eventual colisão de id na página é inofensiva (resolve pra uma def idêntica).
 * Os níveis "Completa" (com o kanji 悟) e "Ícone" vivem como assets em Imagens/Logo/
 * e em app/icon.svg (favicon).
 */
export function LogoMark({ className, alt = "SatorIA" }: { className?: string; alt?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label={alt}
      className={cn("block overflow-hidden", className)}
    >
      <defs>
        <linearGradient id="satoria-blue" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#8FDBFF" />
          <stop offset="1" stopColor="#2E7FF0" />
        </linearGradient>
        <radialGradient id="satoria-bead" cx="0.4" cy="0.36" r="0.72">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#CBF0FF" />
          <stop offset="1" stopColor="#6FB8F5" />
        </radialGradient>
        <path id="satoria-petal" d="M0,-50 C13,-30 12,-8 0,3 C-12,-8 -13,-30 0,-50 Z" />
        <g id="satoria-lotus" fill="url(#satoria-blue)">
          <use href="#satoria-petal" transform="rotate(-90) scale(.6)" opacity=".5" />
          <use href="#satoria-petal" transform="rotate(90) scale(.6)" opacity=".5" />
          <use href="#satoria-petal" transform="rotate(-60) scale(.82)" opacity=".68" />
          <use href="#satoria-petal" transform="rotate(60) scale(.82)" opacity=".68" />
          <use href="#satoria-petal" transform="rotate(-31) scale(.93)" opacity=".85" />
          <use href="#satoria-petal" transform="rotate(31) scale(.93)" opacity=".85" />
          <use href="#satoria-petal" />
        </g>
      </defs>
      <rect width="120" height="120" fill="#0B1526" />
      <circle
        cx="60"
        cy="60"
        r="50"
        fill="none"
        stroke="url(#satoria-blue)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeDasharray="244 70"
        transform="rotate(126 60 60)"
      />
      <use href="#satoria-lotus" transform="translate(60 74) scale(.98)" />
      <circle cx="94" cy="25" r="11" fill="#8FE7FF" opacity="0.22" />
      <circle cx="94" cy="25" r="6.2" fill="url(#satoria-bead)" />
    </svg>
  )
}
