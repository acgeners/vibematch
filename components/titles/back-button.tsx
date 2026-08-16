"use client"

import { ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface BackButtonProps {
  fallbackHref?: string
}

export function BackButton({ fallbackHref = "/catalog" }: BackButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Voltar"
      onClick={handleClick}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  )
}
