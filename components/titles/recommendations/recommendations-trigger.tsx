import Link from "next/link"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

export function RecommendationsTrigger() {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/recommendations">
        <Sparkles className="mr-1 h-4 w-4 text-primary" />
        Recomendar com IA
      </Link>
    </Button>
  )
}
