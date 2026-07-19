import { LogoMark } from "@/components/ui/logo-mark"

/** Marca do SatorIA — badge (lótus/bússola) + "SatorIA" com o "IA" destacado. */
export function Wordmark({ size = "md" }: { size?: "md" | "sm" }) {
  const mark = size === "sm" ? "size-[30px] rounded-[9px]" : "size-[34px] rounded-[10px]"
  const text = size === "sm" ? "text-[19px]" : "text-2xl"

  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={`${mark} shadow-[0_6px_18px_hsl(var(--primary)/0.35)] ring-1 ring-white/10`} />
      <span className={`font-extrabold tracking-[-0.02em] ${text}`}>
        Sator<span className="text-primary">IA</span>
      </span>
    </div>
  )
}
