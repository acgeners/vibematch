export function getCoverImageSrc(url: string | null | undefined): string {
  if (!url) return ""
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === "cdn.anime-planet.com" || host === "www.anime-planet.com") {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`
    }
  } catch {
    return url
  }
  return url
}
