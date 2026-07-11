/** Marca do SatorIA — ✦ + "SatorIA" com o "IA" destacado. */
export function Wordmark({ size = "md" }: { size?: "md" | "sm" }) {
  const mark =
    size === "sm"
      ? "size-[30px] rounded-[9px] text-[15px]"
      : "size-[34px] rounded-[10px] text-[17px]"
  const text = size === "sm" ? "text-[19px]" : "text-2xl"

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid place-items-center bg-gradient-to-br from-primary to-accent-foreground text-white shadow-[0_6px_18px_hsl(var(--primary)/0.45)] ${mark}`}
      >
        ✦
      </span>
      <span className={`font-extrabold tracking-[-0.02em] ${text}`}>
        Sator<span className="text-primary">IA</span>
      </span>
    </div>
  )
}
