"use client"

/* eslint-disable @next/next/no-img-element -- miniaturas são data URI montadas no
   cliente (zero requisição) e o upload é URL externa variável; next/image não cabe. */

import { useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2, Shuffle, Upload, UserCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CABELOS,
  CONFIG_PADRAO,
  ESTILOS,
  ESTILOS_PERSONAGEM,
  ESTILOS_SIMBOLO,
  ESTILO_POR_ID,
  FUNDOS,
  OLHOS_CORES,
  PELES,
  avatarDataUri,
} from "@/lib/avatar/render"
import type { AvatarConfig, Estilo, OpcaoCor } from "@/lib/avatar/render"
import { avatarConfigToUrl, isBuiltAvatarUrl, parseAvatarUrl } from "@/lib/avatar/url"
import { uploadAvatar } from "@/server/actions/account"
import { cn } from "@/lib/utils"

interface AvatarPickerProps {
  /** valor atual de `user_settings.avatar_url` — "" | `/avatar.svg?…` | URL do upload */
  value: string
  onChange: (url: string) => void
}

/**
 * Monta o avatar: estilo + cores, ou uma imagem enviada.
 *
 * 🔴 Preset e personalizado passam pelo MESMO renderizador — as miniaturas de estilo
 * são desenhadas com a configuração ATUAL, então o que se vê na grade é o que se leva.
 * Se a galeria tivesse imagens próprias, ela e o resultado divergiriam no primeiro
 * ajuste de paleta, sem erro e sem log.
 *
 * ⚠️ O preview usa data URI em vez da rota `/avatar.svg`: mexer numa cor gera uma URL
 * nova a cada clique, e cada uma seria uma requisição — o avatar piscaria enquanto a
 * pessoa escolhe. O que vai pro banco continua sendo a URL.
 */
export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [erroImagem, setErroImagem] = useState(false)

  // Config de TRABALHO: começa do que está salvo; se o avatar é um upload (ou não
  // existe), parte do padrão — as grades precisam de cores pra desenhar de qualquer jeito.
  const [config, setConfig] = useState<AvatarConfig>(
    () => parseAvatarUrl(value) ?? CONFIG_PADRAO,
  )

  const montado = parseAvatarUrl(value)
  const enviado = value !== "" && !isBuiltAvatarUrl(value)
  const estiloAtual: Estilo | undefined = montado ? ESTILO_POR_ID[montado.estilo] : undefined
  const eSimbolo = !!estiloAtual?.substituiTudo
  const escondeRosto = eSimbolo || !!estiloAtual?.substituiRosto

  function aplicar(patch: Partial<AvatarConfig>) {
    const nova = { ...config, ...patch }
    setConfig(nova)
    setErroImagem(false)
    onChange(avatarConfigToUrl(nova))
  }

  function sortear() {
    const sorteia = <T,>(lista: T[]): T => lista[Math.floor(Math.random() * lista.length)]
    aplicar({
      estilo: sorteia(ESTILOS).id,
      cabelo: sorteia(CABELOS).cor,
      pele: sorteia(PELES).cor,
      olhos: sorteia(OLHOS_CORES).cor,
      fundo: sorteia(FUNDOS).cor,
    })
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // permite reescolher o mesmo arquivo depois
    if (!file) return

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const result = await uploadAvatar(fd)
      if (result.error || !result.url) {
        toast.error(`Erro no upload: ${result.error ?? "URL ausente"}`)
        return
      }
      // O upload já gravou avatar_url no banco; refletimos no form pro preview seguir.
      setErroImagem(false)
      onChange(result.url)
      toast.success("Imagem enviada.")
    } finally {
      setUploading(false)
    }
  }

  // Preview: montado desenha localmente; enviado usa a URL; sem nada, o mesmo ícone
  // que o chip mostra — a tela não inventa um avatar que o topo não tem.
  const previewSrc = montado ? avatarDataUri(montado) : enviado ? value : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-[76px] shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20 [&_svg]:size-9">
          {previewSrc && !erroImagem ? (
            <img
              src={previewSrc}
              alt="Seu avatar"
              className="size-full object-cover"
              onError={() => setErroImagem(true)}
            />
          ) : (
            <UserCircle />
          )}
        </span>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={sortear}>
            <Shuffle />
            Sortear
          </Button>
          {value !== "" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setErroImagem(false)
                onChange("")
              }}
            >
              Remover
            </Button>
          )}
        </div>
      </div>

      {/* Imagem que não carrega é ESTADO, não silêncio: sem isto, a URL quebrada some
          atrás do ícone padrão e a tela afirma "você não tem avatar". Foi assim que um
          avatar apontando pra um projeto Supabase extinto passou despercebido. */}
      {enviado && erroImagem && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/25">
          A imagem enviada não carrega mais. Envie outra ou monte um avatar abaixo.
        </p>
      )}

      <Grupo titulo="Estilo">
        <Subtitulo>Personagens</Subtitulo>
        <GradeEstilos
          estilos={ESTILOS_PERSONAGEM}
          config={config}
          selecionado={montado?.estilo}
          onPick={(id) => aplicar({ estilo: id })}
        />
        <Subtitulo className="pt-1">Símbolos</Subtitulo>
        <GradeEstilos
          estilos={ESTILOS_SIMBOLO}
          config={config}
          selecionado={montado?.estilo}
          onPick={(id) => aplicar({ estilo: id })}
        />
      </Grupo>

      <Grupo titulo={eSimbolo ? "Cor do motivo" : "Cor do cabelo"}>
        <Cores
          opcoes={CABELOS}
          atual={config.cabelo}
          rotulo="Cor do cabelo"
          onPick={(cor) => aplicar({ cabelo: cor })}
        />
      </Grupo>

      {/* Controle sem efeito não fica na tela: símbolo não tem pele nem olhos, e a
          máscara da Kitsune cobre o rosto. Deixá-los ali seria um clique que não faz nada. */}
      {!escondeRosto && (
        <>
          <Grupo titulo="Tom de pele">
            <Cores
              opcoes={PELES}
              atual={config.pele}
              rotulo="Tom de pele"
              onPick={(cor) => aplicar({ pele: cor })}
            />
          </Grupo>
          <Grupo titulo="Olhos">
            <Cores
              opcoes={OLHOS_CORES}
              atual={config.olhos}
              rotulo="Cor dos olhos"
              onPick={(cor) => aplicar({ olhos: cor })}
            />
          </Grupo>
        </>
      )}
      {estiloAtual?.nota && (
        <p className="-mt-2 text-[11px] text-muted-foreground">{estiloAtual.nota}.</p>
      )}

      <Grupo titulo="Fundo">
        <Cores
          opcoes={FUNDOS}
          atual={config.fundo}
          rotulo="Cor de fundo"
          onPick={(cor) => aplicar({ fundo: cor })}
        />
      </Grupo>

      <Grupo titulo="Ou envie a sua imagem">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={onPickFile}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {uploading ? "Enviando…" : "Enviar imagem"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            PNG, JPG, WEBP ou GIF até 2 MB — substitui o avatar montado.
          </p>
        </div>
      </Grupo>
    </div>
  )
}

// ————————————————————— peças da tela —————————————————————

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold">{titulo}</p>
      {children}
    </div>
  )
}

function Subtitulo({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  )
}

function GradeEstilos({
  estilos,
  config,
  selecionado,
  onPick,
}: {
  estilos: Estilo[]
  config: AvatarConfig
  selecionado: string | undefined
  onPick: (id: string) => void
}) {
  return (
    <div role="radiogroup" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {estilos.map((e) => (
        <button
          key={e.id}
          type="button"
          role="radio"
          aria-checked={e.id === selecionado}
          title={e.nome}
          onClick={() => onPick(e.id)}
          className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-checked:text-foreground"
        >
          <img
            // A miniatura usa a configuração ATUAL — muda de cor junto com as paletas.
            src={avatarDataUri({ ...config, estilo: e.id })}
            alt=""
            width={48}
            height={48}
            className={cn(
              "size-12 rounded-full",
              e.id === selecionado && "ring-2 ring-primary ring-offset-2 ring-offset-card",
            )}
          />
          <span className="max-w-full truncate">{e.nome}</span>
        </button>
      ))}
    </div>
  )
}

function Cores({
  opcoes,
  atual,
  rotulo,
  onPick,
}: {
  opcoes: OpcaoCor[]
  atual: string
  rotulo: string
  onPick: (cor: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex flex-wrap gap-2">
      {opcoes.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.cor.toLowerCase() === atual.toLowerCase()}
          aria-label={o.nome}
          title={o.nome}
          onClick={() => onPick(o.cor)}
          style={{ background: o.cor }}
          className={cn(
            "size-7 rounded-full ring-1 ring-white/15 transition-transform hover:scale-110",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "aria-checked:ring-2 aria-checked:ring-primary aria-checked:ring-offset-2 aria-checked:ring-offset-card",
          )}
        />
      ))}
    </div>
  )
}
