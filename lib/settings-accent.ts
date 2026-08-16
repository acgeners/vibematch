// Accent system shared by the /curation/settings page sections and their panels.
// Full class strings (no interpolation) so Tailwind's JIT picks them up.

export type SettingsAccent =
  | "cyan"
  | "violet"
  | "emerald"
  | "slate"
  | "amber"
  | "indigo"
  | "rose"
  | "fuchsia"

// Solid accent button styling per section — passed as className to <Button>.
// `bg-none` neutralizes the default variant's cyan gradient (background-image),
// which tailwind-merge keeps alongside our background-color otherwise.
export const ACCENT_BUTTON: Record<SettingsAccent, string> = {
  cyan: "bg-none bg-cyan-600 text-white hover:bg-cyan-700 dark:bg-cyan-500 dark:hover:bg-cyan-600 shadow-sm shadow-cyan-500/25",
  violet:
    "bg-none bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600 shadow-sm shadow-violet-500/25",
  emerald:
    "bg-none bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 shadow-sm shadow-emerald-500/25",
  amber:
    "bg-none bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 shadow-sm shadow-amber-500/25",
  slate:
    "bg-none bg-slate-600 text-white hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 shadow-sm shadow-slate-500/20",
  indigo:
    "bg-none bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 shadow-sm shadow-indigo-500/25",
  rose: "bg-none bg-rose-600 text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-600 shadow-sm shadow-rose-500/25",
  fuchsia:
    "bg-none bg-fuchsia-600 text-white hover:bg-fuchsia-700 dark:bg-fuchsia-500 dark:hover:bg-fuchsia-600 shadow-sm shadow-fuchsia-500/25",
}

/** Tinted accent link styling — used by the navigation cards (Uso da API, etc.). */
export const ACCENT_LINK: Record<SettingsAccent, string> = {
  cyan: "border border-cyan-500/55 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20 dark:text-cyan-300",
  violet: "border border-violet-500/55 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-300",
  emerald: "border border-emerald-500/55 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
  amber: "border border-amber-500/55 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300",
  slate: "border border-slate-500/55 bg-slate-500/10 text-slate-600 hover:bg-slate-500/20 dark:text-slate-300",
  indigo: "border border-indigo-500/55 bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 dark:text-indigo-300",
  rose: "border border-rose-500/55 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-300",
  fuchsia: "border border-fuchsia-500/55 bg-fuchsia-500/10 text-fuchsia-600 hover:bg-fuchsia-500/20 dark:text-fuchsia-300",
}
