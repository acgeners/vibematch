// ============================================================================
// Renderizador ÚNICO de avatar: configuração → SVG.
//
// Os "presets" da galeria são configurações deste mesmo renderizador — não um
// segundo conjunto de arquivos. Isso mata por construção a classe de erro que o
// CLAUDE.md chama de "dois critérios pro mesmo fato": se preset e customizado
// fossem mecanismos diferentes, um dia a miniatura da galeria mostraria uma coisa
// e o chip da conta mostraria outra, sem erro e sem log.
//
// Puro (sem `server-only`, sem I/O) de propósito: a rota `/avatar.svg` e o painel
// de /conta importam o MESMO código, então o que a pessoa vê montando é byte a byte
// o que fica salvo. Quem valida entrada é `lib/avatar/url.ts` — nada aqui interpola
// string sem passar por lá.
// ============================================================================

export interface AvatarConfig {
  /** id de um `ESTILOS` — personagem (busto) ou símbolo (motivo). */
  estilo: string
  /** cor principal: cabelo no personagem, motivo no símbolo. */
  cabelo: string
  pele: string
  olhos: string
  fundo: string
}

export interface Estilo {
  id: string
  nome: string
  /** desenhado atrás do busto */
  tras?: string
  /** desenhado sobre o rosto */
  frente?: string
  /** substitui olhos e pele (máscara) */
  substituiRosto?: string
  /** desenhado antes dos olhos (sombra de capuz) */
  antesDosOlhos?: string
  /** substitui o busto inteiro (símbolos) */
  substituiTudo?: string
  /** aviso curto exibido no painel quando um controle não se aplica */
  nota?: string
}

export interface OpcaoCor {
  id: string
  nome: string
  cor: string
}

// ————— paletas oferecidas ao usuário —————

export const PELES: OpcaoCor[] = [
  { id: "porcelana", nome: "Porcelana", cor: "#fbe6d4" },
  { id: "clara",     nome: "Clara",     cor: "#f0c9a6" },
  { id: "media",     nome: "Média",     cor: "#d7a276" },
  { id: "morena",    nome: "Morena",    cor: "#b47b4e" },
  { id: "escura",    nome: "Escura",    cor: "#7e5134" },
]

export const CABELOS: OpcaoCor[] = [
  { id: "noite",    nome: "Preto azulado", cor: "#2c3654" },
  { id: "castanho", nome: "Castanho",      cor: "#6b4522" },
  { id: "loiro",    nome: "Loiro",         cor: "#b8912a" },
  { id: "ruivo",    nome: "Ruivo",         cor: "#a33327" },
  { id: "prata",    nome: "Prata",         cor: "#7e8a99" },
  { id: "branco",   nome: "Branco",        cor: "#c9d2dc" },
  { id: "rosa",     nome: "Rosa",          cor: "#c9497e" },
  { id: "roxo",     nome: "Roxo",          cor: "#6b3e96" },
  { id: "azul",     nome: "Azul",          cor: "#2a6ba8" },
  { id: "verde",    nome: "Verde",         cor: "#357f5c" },
]

export const OLHOS_CORES: OpcaoCor[] = [
  { id: "castanho", nome: "Castanho", cor: "#4a2e1c" },
  { id: "ambar",    nome: "Âmbar",    cor: "#a9662a" },
  { id: "verde",    nome: "Verde",    cor: "#2f7a4f" },
  { id: "azul",     nome: "Azul",     cor: "#2c6fa6" },
  { id: "cinza",    nome: "Cinza",    cor: "#55636f" },
  { id: "violeta",  nome: "Violeta",  cor: "#6b4a9e" },
  { id: "vermelho", nome: "Vermelho", cor: "#9e2f2f" },
  { id: "dourado",  nome: "Dourado",  cor: "#b8912a" },
]

export const FUNDOS: OpcaoCor[] = [
  { id: "navy",     nome: "Navy",     cor: "#101a2e" },
  { id: "teal",     nome: "Teal",     cor: "#0c2029" },
  { id: "floresta", nome: "Floresta", cor: "#0e1f16" },
  { id: "vinho",    nome: "Vinho",    cor: "#26101b" },
  { id: "ameixa",   nome: "Ameixa",   cor: "#1e1030" },
  { id: "terra",    nome: "Terra",    cor: "#241a0c" },
  { id: "carvao",   nome: "Carvão",   cor: "#16181c" },
  { id: "brasa",    nome: "Brasa",    cor: "#26090c" },
]

// ————— utilidades de cor —————

function hexParaRgb(hex: string): number[] {
  const h = hex.replace("#", "")
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
function rgbParaHex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")
}
/** Mistura `hex` com branco (t>0) ou preto (t<0). t em −1..1. */
export function mistura(hex: string, t: number): string {
  const alvo = t >= 0 ? 255 : 0
  const k = Math.abs(t)
  return rgbParaHex(hexParaRgb(hex).map((v) => v + (alvo - v) * k))
}

// ————— peças compartilhadas do busto —————

const OLHO_SVG = (iris: string) => `
  <g>
    <ellipse cx="49" cy="58" rx="5" ry="6.4" fill="${iris}"/>
    <ellipse cx="71" cy="58" rx="5" ry="6.4" fill="${iris}"/>
    <circle cx="47.4" cy="55.6" r="1.9" fill="#fff" opacity=".92"/>
    <circle cx="69.4" cy="55.6" r="1.9" fill="#fff" opacity=".92"/>
  </g>
  <g fill="#000" opacity=".14">
    <ellipse cx="41" cy="67" rx="4.6" ry="2.2"/>
    <ellipse cx="79" cy="67" rx="4.6" ry="2.2"/>
  </g>`

// Ombros LARGOS e altos (y=89) com pescoço curto e grosso: com pescoço de 16px
// contra um rosto de 52px, o busto lia como pirulito (medido no render).
const CORPO_SVG = (pele: string, roupa: string) => `
  <path d="M49 68 h22 v22 h-22 Z" fill="${mistura(pele, -0.13)}"/>
  <path d="M10 120 C17 96 33 88 60 88 C87 88 103 96 110 120 Z" fill="${roupa}"/>
  <path d="M60 22 C77 22 86 34 86 52 C86 69 75 81 60 81 C45 81 34 69 34 52 C34 34 43 22 60 22 Z" fill="${pele}"/>`

// ————— os 12 estilos de cabeça —————
// `tras` desenha atrás do busto; `frente` sobre o rosto; `depois` por cima de tudo.

export const ESTILOS: Estilo[] = [
  {
    id: "aiko", nome: "Aiko",
    tras: `<path d="M30 54 C30 27 43 14 60 14 C77 14 90 27 90 54 L95 120 L77 120 L74 58 L46 58 L43 120 L25 120 Z"/>`,
    frente: `<path d="M30 56 C30 28 43 16 60 16 C77 16 90 28 90 56 C88 44 84 38 78 34 C70 44 54 48 40 45 C35 47 31 50 30 56 Z"/>`,
  },
  {
    id: "seo-yun", nome: "Seo-yun",
    tras: `<circle cx="26" cy="28" r="15"/><circle cx="94" cy="28" r="15"/>`,
    frente: `<path d="M30 54 C30 26 43 15 60 15 C77 15 90 26 90 54 C87 42 82 36 76 33 C68 43 52 47 39 44 C34 46 31 49 30 54 Z"/>
             <path d="M32 48 C29 62 30 76 34 86 L26 88 C22 74 23 58 26 46 Z"/>
             <path d="M88 48 C91 62 90 76 86 86 L94 88 C98 74 97 58 94 46 Z"/>`,
  },
  {
    id: "rin", nome: "Rin",
    tras: `<path d="M82 24 C104 20 117 36 113 58 C110 76 98 86 87 88 C97 72 100 50 82 38 Z"/>`,
    frente: `<path d="M30 54 C30 26 43 15 60 15 C79 15 91 27 91 46 C86 37 78 32 68 31 C58 43 44 47 36 45 C33 47 31 50 30 54 Z"/>`,
  },
  {
    id: "kaito", nome: "Kaito",
    // Touca sólida + pontas SOBREPOSTAS com a base dentro dela. Ponta solta deixa o
    // crânio à mostra (lê como coroa); e um caminho único em zigue-zague cria vale
    // abaixo da linha da franja, que auto-intersecta e abre buraco no preenchimento.
    tras: "",
    frente: `<path d="M31 58 C31 28 43 17 60 17 C77 17 89 28 89 58 C85 46 76 42 60 42 C44 42 35 46 31 58 Z"/>
             <path d="M34 40 L38 14 L47 34 Z"/><path d="M43 36 L52 10 L57 32 Z"/>
             <path d="M54 34 L64 12 L69 33 Z"/><path d="M65 34 L76 16 L79 36 Z"/>
             <path d="M74 38 L86 24 L88 44 Z"/>`,
  },
  {
    id: "hana", nome: "Hana",
    tras: `<path d="M30 52 C30 26 43 14 60 14 C77 14 90 26 90 52 L92 104 L78 104 L76 56 L44 56 L42 104 L28 104 Z"/>`,
    frente: `<path d="M30 54 C30 26 43 15 60 15 C77 15 90 26 90 54 L90 40 C82 36 72 34 60 34 C48 34 38 36 30 40 Z"/>
             <path d="M28 40 h13 v36 a6.5 6.5 0 0 1 -13 0 Z"/>
             <path d="M79 40 h13 v36 a6.5 6.5 0 0 1 -13 0 Z"/>`,
  },
  {
    id: "yuna", nome: "Yuna",
    // As tranças precisam ENCOSTAR na massa do cabelo: começando fora do crânio,
    // liam como brincos flutuando.
    tras: `<path d="M31 54 C31 27 44 15 60 15 C76 15 89 27 89 54 L86 64 L34 64 Z"/>
           <circle cx="30" cy="62" r="10"/><circle cx="27" cy="77" r="9"/><circle cx="25" cy="91" r="7.5"/>
           <circle cx="90" cy="62" r="10"/><circle cx="93" cy="77" r="9"/><circle cx="95" cy="91" r="7.5"/>`,
    frente: `<path d="M30 54 C30 26 43 15 60 15 C77 15 90 26 90 54 C86 42 80 36 72 33 C64 44 48 47 38 43 C34 45 31 49 30 54 Z"/>`,
  },
  {
    id: "ji-woo", nome: "Ji-woo",
    tras: `<path d="M29 54 C29 26 43 14 60 14 C77 14 91 26 91 54 L93 76 C93 84 86 88 80 84 L78 56 L42 56 L40 84 C34 88 27 84 27 76 Z"/>`,
    frente: `<path d="M29 56 C29 26 43 15 60 15 C77 15 91 26 91 56 C88 44 82 37 74 34 C65 45 48 48 37 44 C33 47 30 51 29 56 Z"/>`,
  },
  {
    id: "ren", nome: "Ren",
    tras: `<path d="M34 50 C34 26 45 15 60 15 C75 15 86 26 86 50 L88 60 L32 60 Z"/>
           <path d="M52 58 h16 l6 46 a10 10 0 0 1 -28 0 Z"/>`,
    frente: `<path d="M32 54 C32 26 44 15 60 15 C76 15 88 26 88 54 C85 43 79 37 71 34 C63 44 49 47 39 44 C35 46 33 50 32 54 Z"/>
             <path d="M32 44 L38 44 L36 78 L30 76 Z"/><path d="M88 44 L82 44 L84 78 L90 76 Z"/>`,
  },
  {
    id: "mei", nome: "Mei",
    tras: `<circle cx="34" cy="34" r="17"/><circle cx="60" cy="24" r="18"/><circle cx="86" cy="34" r="17"/>
           <circle cx="26" cy="56" r="15"/><circle cx="94" cy="56" r="15"/>
           <circle cx="30" cy="74" r="12"/><circle cx="90" cy="74" r="12"/>`,
    frente: `<path d="M32 52 C32 30 44 20 60 20 C76 20 88 30 88 52 C84 42 78 37 70 35 C62 45 48 48 38 44 C35 46 33 49 32 52 Z"/>`,
  },
  {
    id: "tae", nome: "Tae",
    // Franja lateral longa cobrindo um olho. O undercut que tentei antes não tinha
    // silhueta e virava touca de natação.
    tras: "",
    frente: `<path d="M29 54 C29 26 43 14 60 14 C79 14 92 27 92 54 L89 76 C87 50 79 37 64 33 C50 39 37 44 29 54 Z"/>`,
  },
  {
    id: "sora", nome: "Sora",
    tras: `<path d="M18 120 C14 74 32 46 60 46 C88 46 106 74 102 120 L84 120 C88 84 78 62 60 62 C42 62 32 84 36 120 Z"/>`,
    frente: `<path d="M34 58 C34 34 45 22 60 22 C75 22 86 34 86 58 C82 44 74 38 60 38 C46 38 38 44 34 58 Z"/>`,
    // A sombra do capuz cai sobre a TESTA e os olhos. Invertida, ela atravessava o
    // rosto na altura do nariz e lia como máscara cirúrgica.
    antesDosOlhos: `<path d="M34 52 C34 34 45 22 60 22 C75 22 86 34 86 52 C86 62 82 68 74 68 L46 68 C38 68 34 62 34 52 Z" fill="#050B12" opacity=".62"/>`,
    nota: "o capuz deixa os olhos na sombra",
  },
  {
    id: "kitsune", nome: "Kitsune",
    tras: `<path d="M31 54 C31 27 44 15 60 15 C76 15 89 27 89 54 L91 96 L78 96 L76 58 L44 58 L42 96 L29 96 Z"/>`,
    frente: `<path d="M30 54 C30 26 43 15 60 15 C77 15 90 26 90 54 C86 42 80 36 72 33 C64 44 48 47 38 43 C34 45 31 49 30 54 Z"/>`,
    // A máscara substitui o rosto: cor de pele e de olho não aparecem neste estilo.
    substituiRosto: `
      <g fill="#F3ECE2">
        <path d="M34 30 L30 8 L48 18 Z"/><path d="M86 30 L90 8 L72 18 Z"/>
        <path d="M60 26 C78 26 88 38 88 54 C88 72 76 86 60 86 C44 86 32 72 32 54 C32 38 42 26 60 26 Z"/>
      </g>
      <g fill="#D93B34">
        <path d="M36 30 L33 16 L45 22 Z"/><path d="M84 30 L87 16 L75 22 Z"/>
        <path d="M40 44 C46 40 54 40 58 44 C52 50 44 50 40 44 Z"/>
        <path d="M80 44 C74 40 66 40 62 44 C68 50 76 50 80 44 Z"/>
        <path d="M52 72 C56 68 64 68 68 72 C64 78 56 78 52 72 Z"/>
      </g>
      <g fill="#1A0A0C">
        <ellipse cx="48" cy="56" rx="4.6" ry="5.4"/><ellipse cx="72" cy="56" rx="4.6" ry="5.4"/>
      </g>
      <g fill="#fff" opacity=".85"><circle cx="46.6" cy="54" r="1.6"/><circle cx="70.6" cy="54" r="1.6"/></g>`,
    nota: "a máscara cobre o rosto — pele e olhos não aparecem",
  },
]

// ————— os 6 símbolos —————
// Também são ESTILOS, e não um segundo conjunto de arquivos: substituem o busto
// inteiro e usam a cor principal + o fundo escolhidos. Assim a galeria toda passa
// por um renderizador só, e pele/olhos simplesmente não se aplicam aqui.

const PETALA = "M0,-50 C13,-30 12,-8 0,3 C-12,-8 -13,-30 0,-50 Z"

/** Espiral de Arquimedes como polyline — legível com traço grosso, ao contrário
 *  de anéis concêntricos, que viravam borrão a 36px. */
function espiralPath(r0 = 3, r1 = 40, voltas = 2.6, passos = 160): string {
  const total = voltas * 2 * Math.PI
  const pts: string[] = []
  for (let i = 0; i <= passos; i++) {
    const t = (i / passos) * total
    const r = r0 + ((r1 - r0) * t) / total
    pts.push(`${(60 + r * Math.cos(t)).toFixed(1)} ${(60 + r * Math.sin(t)).toFixed(1)}`)
  }
  return `M${pts.join(" L")}`
}

const SIMBOLOS: Estilo[] = [
  {
    id: "enso", nome: "Ensō",
    substituiTudo: `
      <circle cx="60" cy="60" r="37" fill="none" stroke="url(#cabelo)" stroke-width="7.5"
              stroke-linecap="round" stroke-dasharray="188 45" transform="rotate(126 60 60)"/>
      <circle cx="88" cy="30" r="5.4" fill="url(#cabelo)" opacity=".9"/>`,
  },
  {
    id: "lotus", nome: "Lótus",
    substituiTudo: `
      <g fill="url(#cabelo)" transform="translate(60 82) scale(1.02)">
        <path d="${PETALA}" transform="rotate(-90) scale(.6)" opacity=".5"/>
        <path d="${PETALA}" transform="rotate(90) scale(.6)" opacity=".5"/>
        <path d="${PETALA}" transform="rotate(-60) scale(.82)" opacity=".68"/>
        <path d="${PETALA}" transform="rotate(60) scale(.82)" opacity=".68"/>
        <path d="${PETALA}" transform="rotate(-31) scale(.93)" opacity=".85"/>
        <path d="${PETALA}" transform="rotate(31) scale(.93)" opacity=".85"/>
        <path d="${PETALA}"/>
      </g>`,
  },
  {
    id: "lua", nome: "Lua",
    substituiTudo: `
      <mask id="lua"><rect width="120" height="120" fill="black"/>
        <circle cx="58" cy="60" r="34" fill="white"/><circle cx="76" cy="48" r="29" fill="black"/></mask>
      <rect width="120" height="120" fill="url(#cabelo)" mask="url(#lua)"/>
      <circle cx="88" cy="82" r="3.2" fill="url(#cabelo)" opacity=".85"/>
      <circle cx="97" cy="66" r="2.1" fill="url(#cabelo)" opacity=".6"/>
      <circle cx="30" cy="30" r="2.4" fill="url(#cabelo)" opacity=".55"/>`,
  },
  {
    id: "sakura", nome: "Sakura",
    substituiTudo: `
      <g fill="url(#cabelo)" transform="translate(60 60)">
        <path d="${PETALA}" transform="rotate(0) scale(.78)"/>
        <path d="${PETALA}" transform="rotate(72) scale(.78)"/>
        <path d="${PETALA}" transform="rotate(144) scale(.78)"/>
        <path d="${PETALA}" transform="rotate(216) scale(.78)"/>
        <path d="${PETALA}" transform="rotate(288) scale(.78)"/>
      </g>
      <circle cx="60" cy="60" r="5.5" fill="#fff" opacity=".8"/>`,
  },
  {
    id: "torii", nome: "Torii",
    substituiTudo: `
      <g fill="url(#cabelo)">
        <rect x="16" y="30" width="88" height="9" rx="4.5"/>
        <path d="M12 26 L108 26 L104 34 L16 34 Z"/>
        <rect x="26" y="48" width="68" height="8" rx="4"/>
        <rect x="34" y="34" width="10" height="62" rx="4"/>
        <rect x="76" y="34" width="10" height="62" rx="4"/>
      </g>`,
  },
  {
    id: "onda", nome: "Onda",
    substituiTudo: `
      <g fill="none" stroke="url(#cabelo)" stroke-width="6" stroke-linecap="round">
        <path d="M14 92 A46 46 0 0 1 106 92" opacity=".35"/>
        <path d="M26 92 A34 34 0 0 1 94 92" opacity=".6"/>
        <path d="M38 92 A22 22 0 0 1 82 92" opacity=".85"/>
        <path d="M50 92 A10 10 0 0 1 70 92"/>
      </g>`,
  },
  {
    id: "montanha", nome: "Montanha",
    substituiTudo: `
      <circle cx="80" cy="40" r="13" fill="url(#cabelo)" opacity=".55"/>
      <g fill="url(#cabelo)">
        <path d="M52 94 L80 50 L106 94 Z" opacity=".7"/>
        <path d="M14 94 L46 40 L78 94 Z"/>
      </g>
      <path d="M46 40 L36 57 L46 62 L56 57 Z" fill="#fff" opacity=".55"/>`,
  },
  {
    id: "constelacao", nome: "Constelação",
    substituiTudo: `
      <g stroke="url(#cabelo)" stroke-width="3" stroke-linecap="round" opacity=".68" fill="none">
        <path d="M28 78 L48 44 L72 58 L94 32"/><path d="M48 44 L62 88"/>
      </g>
      <g fill="url(#cabelo)">
        <circle cx="28" cy="78" r="4"/><circle cx="48" cy="44" r="6"/><circle cx="72" cy="58" r="4.4"/>
        <circle cx="94" cy="32" r="5.2"/><circle cx="62" cy="88" r="3.4"/>
      </g>`,
  },
  {
    id: "folha", nome: "Folha",
    substituiTudo: `
      <path d="M60 18 C92 40 92 82 60 102 C28 82 28 40 60 18 Z" fill="url(#cabelo)"/>
      <g stroke="#000" stroke-opacity=".3" stroke-width="2.4" stroke-linecap="round" fill="none">
        <path d="M60 26 L60 98"/><path d="M60 48 L44 40"/><path d="M60 48 L76 40"/>
        <path d="M60 68 L42 58"/><path d="M60 68 L78 58"/>
      </g>`,
  },
  {
    id: "bambu", nome: "Bambu",
    // Uma haste dominante + folhas em leque. Duas hastes de peso igual liam como
    // ESCADA — as marcas de nó viravam degraus entre elas.
    // ⚠️ As marcas usam preto translúcido, não a cor do fundo: aqui o fundo é
    // escolhido pelo usuário, e fixá-lo apagaria as marcas em metade das paletas.
    substituiTudo: `
      <path d="M78 104 L78 46" stroke="url(#cabelo)" stroke-width="7" stroke-linecap="round"
            fill="none" opacity=".38"/>
      <path d="M48 106 L48 20" stroke="url(#cabelo)" stroke-width="10" stroke-linecap="round" fill="none"/>
      <g stroke="#000" stroke-opacity=".5" stroke-width="2.8">
        <path d="M43.6 84 L52.4 84"/><path d="M43.6 58 L52.4 58"/><path d="M43.6 36 L52.4 36"/>
      </g>
      <g fill="url(#cabelo)">
        <path d="M50 44 C68 34 82 38 92 48 C74 56 58 54 50 44 Z"/>
        <path d="M50 68 C66 61 78 65 86 74 C69 80 56 77 50 68 Z" opacity=".72"/>
        <path d="M46 30 C34 22 26 26 20 34 C32 41 41 39 46 30 Z" opacity=".55"/>
      </g>`,
  },
  {
    id: "chuva", nome: "Chuva",
    substituiTudo: `
      <path d="M60 26 C74 46 80 56 80 64 a20 20 0 0 1 -40 0 C40 56 46 46 60 26 Z" fill="url(#cabelo)"/>
      <g fill="url(#cabelo)" opacity=".55">
        <path d="M30 58 C37 68 40 73 40 77 a10 10 0 0 1 -20 0 C20 73 23 68 30 58 Z"/>
        <path d="M92 62 C98 71 100 75 100 78 a8 8 0 0 1 -16 0 C84 75 86 71 92 62 Z"/>
      </g>`,
  },
  {
    id: "espiral", nome: "Espiral",
    substituiTudo: `<path d="${espiralPath()}" fill="none" stroke="url(#cabelo)" stroke-width="7.5" stroke-linecap="round"/>`,
  },
]

ESTILOS.push(...SIMBOLOS)

export const ESTILO_POR_ID = Object.fromEntries(ESTILOS.map((e) => [e.id, e]))
export const ESTILOS_PERSONAGEM = ESTILOS.filter((e) => !e.substituiTudo)
export const ESTILOS_SIMBOLO = ESTILOS.filter((e) => e.substituiTudo)

// ————— o renderizador —————

export const CONFIG_PADRAO: AvatarConfig = {
  estilo: "aiko",
  cabelo: "#2c3654",
  pele: "#f0c9a6",
  olhos: "#4a2e1c",
  fundo: "#101a2e",
}

/**
 * config → string SVG (viewBox 120×120, pensado pra recorte circular).
 *
 * ⚠️ `gradientUnits="userSpaceOnUse"`, nunca o padrão `objectBoundingBox`: um traço
 * VERTICAL tem bbox de largura ZERO e a spec manda não renderizar o elemento — o
 * cabelo simplesmente sumia, sem erro nenhum.
 */
export function renderAvatar(config: Partial<AvatarConfig> = {}): string {
  const c = { ...CONFIG_PADRAO, ...config }
  const estilo = ESTILO_POR_ID[c.estilo] ?? ESTILOS[0]
  const brilho = mistura(c.cabelo, 0.42)
  const roupa = mistura(c.fundo, 0.16)
  const rosto = estilo.substituiRosto
    ? estilo.substituiRosto
    : (estilo.antesDosOlhos ?? "") + OLHO_SVG(c.olhos)

  // Símbolo: a cor principal vira o motivo e o busto não existe. Pele e olhos não
  // se aplicam, e a UI esconde esses controles em vez de deixá-los sem efeito.
  const figura = estilo.substituiTudo
    ? estilo.substituiTudo
    : `<g fill="url(#cabelo)">${estilo.tras}</g>
${CORPO_SVG(c.pele, roupa)}
  <g fill="url(#cabelo)">${estilo.frente}</g>
${rosto}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${estilo.nome}">
  <defs>
    <linearGradient id="cabelo" gradientUnits="userSpaceOnUse" x1="30" y1="10" x2="80" y2="100">
      <stop offset="0" stop-color="${brilho}"/>
      <stop offset=".55" stop-color="${c.cabelo}"/>
      <stop offset="1" stop-color="${c.cabelo}"/>
    </linearGradient>
    <radialGradient id="tile" gradientUnits="userSpaceOnUse" cx="34" cy="22" r="118">
      <stop offset="0" stop-color="${brilho}" stop-opacity=".22"/>
      <stop offset="1" stop-color="${c.fundo}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="120" height="120" fill="${c.fundo}"/>
  <rect width="120" height="120" fill="url(#tile)"/>
${figura}
</svg>`
}

/** SVG → data URI, que é o que um `<img src>` consome. Sem Buffer nem btoa, pra
 *  rodar igual no Node e no browser (o mockup e o app usam a mesma função). */
export function avatarDataUri(config: Partial<AvatarConfig>): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(renderAvatar(config))
}
