import { NextResponse } from "next/server"
import { listExternalSources } from "@/server/actions/external"

export async function GET() {
  return NextResponse.json(await listExternalSources())
}
