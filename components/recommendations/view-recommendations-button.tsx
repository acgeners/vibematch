import Link from "next/link"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ViewRecommendationsButtonProps {
  variant?: "default" | "secondary" | "outline" | "ghost"
  size?: "sm" | "default" | "lg"
}

export function ViewRecommendationsButton({
  variant = "outline",
  size = "sm",
}: ViewRecommendationsButtonProps) {
  return (
    <Button asChild variant={variant} size={size} className="gap-1.5">
      <Link href="/recommendations">
        <History className="h-3.5 w-3.5" />
        Ver últimas recomendações
      </Link>
    </Button>
  )
}
