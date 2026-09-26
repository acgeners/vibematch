"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { ERROR_COPY } from "@/lib/errors/copy"

/**
 * Boundary do segmento RAIZ: cobre erro inesperado de qualquer página descendente.
 *
 * 🔴 O que ele substitui foi MEDIDO em 2026-08-23 com o backend derrubado: o Next servia
 * "This page couldn't load / A server error occurred. Reload to try again." com um número
 * cru ao lado — em inglês, num app inteiro em português, e sem dizer o que fazer além de
 * recarregar. O erro não some daqui; o que muda é quem o explica.
 *
 * ⚠️ O ROOT LAYOUT continua de pé quando este boundary acende (barra superior, busca, tema):
 * `error.tsx` envolve a PÁGINA do segmento, nunca o layout do próprio segmento. Quem cobre a
 * falha do root layout é `app/global-error.tsx`, e é por isso que os dois existem.
 *
 * ⚠️ Sem `console.error(error)` aqui, de propósito. Erro de Server Component já é registrado
 * no servidor pelo próprio Next (e, quando A3.2 estiver integrada, como evento estruturado);
 * repetir no cliente produziria duas linhas para o mesmo fato sem acrescentar informação.
 * LACUNA registrada: erro puramente CLIENT-side, depois da hidratação, não chega ao hook do
 * servidor — fechar isso é telemetria de cliente, e é gate próprio.
 *
 * 🔴 O retry é RELOAD DE DOCUMENTO, e isso contraria o exemplo canônico do Next por medição,
 * não por gosto. Probe determinístico em 2026-08-23 (falha → causa removida → clique), build
 * de produção local:
 *
 *   | entrada                  | `reset()` | `unstable_retry()`            |
 *   | carga direta (F5, link)  | não        | **NÃO** — e DEGRADA a tela    |
 *   | navegação client-side    | não        | sim                           |
 *
 * Na carga direta — que é a forma do incidente — `unstable_retry()` rebusca o RSC (observado:
 * `GET /rota?_rsc=…`) e mesmo assim troca este boundary em português pelo fallback INTERNO do
 * Next, em inglês ("This page couldn't load"). Ou seja: o botão oficial piorava a tela
 * justamente no caminho que importa. Recarregar recupera nos dois caminhos, e dentro de um
 * error boundary não há estado de cliente que valha a pena preservar.
 */
export default function AppError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  // Reload de documento, e SÓ no clique: sem timer, sem tentativa automática, sem estratégia
  // concorrente. Se a causa ainda estiver de pé, a página volta a ESTE boundary — que é a
  // propriedade que o mecanismo anterior violava.
  const tentarNovamente = () => window.location.reload()

  return (
    <EmptyState
      icon={<AlertTriangle aria-hidden className="mx-auto size-10" />}
      title={ERROR_COPY.titulo}
      description={ERROR_COPY.descricao}
      action={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={tentarNovamente}>{ERROR_COPY.tentarNovamente}</Button>
            <Button asChild variant="outline">
              <Link href="/">{ERROR_COPY.inicio}</Link>
            </Button>
          </div>
          {/* Política do DIGEST: exibido, discreto, e SÓ ele. É um hash que o Next também
              grava no log do servidor, então é o único fio que liga esta tela àquela linha —
              sem ele, "deu erro na home às 14h" não encontra nada. NÃO é a mensagem do erro:
              não carrega tabela, coluna, fornecedor nem credencial. Quando não há digest, a
              linha não aparece, em vez de imprimir "undefined". */}
          {error.digest ? (
            <p className="text-[11px] text-muted-foreground/70">
              {ERROR_COPY.referencia} {error.digest}
            </p>
          ) : null}
        </div>
      }
    />
  )
}
