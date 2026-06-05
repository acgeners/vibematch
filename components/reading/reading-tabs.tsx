"use client"

import { BookOpen, Hourglass } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ReadingList } from "@/components/reading/reading-list"
import type { ReadingWork } from "@/server/queries/reading"

export function ReadingTabs({
  reading,
  hiatus,
}: {
  reading: ReadingWork[]
  hiatus: ReadingWork[]
}) {
  return (
    <Tabs defaultValue="reading" className="gap-4">
      <TabsList>
        <TabsTrigger value="reading" className="gap-1.5">
          <BookOpen className="size-4" />
          Em leitura
          <span className="ml-0.5 tabular-nums text-muted-foreground">{reading.length}</span>
        </TabsTrigger>
        <TabsTrigger value="hiatus" className="gap-1.5">
          <Hourglass className="size-4" />
          Hiatus
          <span className="ml-0.5 tabular-nums text-muted-foreground">{hiatus.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="reading">
        <ReadingList works={reading} variant="reading" />
      </TabsContent>
      <TabsContent value="hiatus">
        <ReadingList works={hiatus} variant="hiatus" />
      </TabsContent>
    </Tabs>
  )
}
