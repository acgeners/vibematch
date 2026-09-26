/**
 * Os textos do estado de erro, com DONO ÚNICO.
 *
 * 🔴 Existe porque `app/error.tsx` e `app/global-error.tsx` dizem a MESMA coisa e NÃO podem
 * dividir markup: o global substitui o root layout, então não tem CSS do projeto, nem
 * providers, nem `Button`. Compartilhar o componente criaria dependência incompatível;
 * compartilhar só a FRASE evita que as duas telas divirjam no primeiro ajuste de redação —
 * que é a família "dois critérios pro mesmo fato" na superfície que a pessoa lê.
 *
 * ⚠️ Nenhuma frase daqui pode citar tabela, coluna, fornecedor ou mensagem interna. O que o
 * usuário recebe é o que ELE pode fazer; o que aconteceu vive no log do servidor.
 */
export const ERROR_COPY = {
  titulo: "Não foi possível carregar esta página",
  descricao:
    "Foi um problema temporário do nosso lado. Tente de novo em instantes — seus dados não foram perdidos.",
  tentarNovamente: "Tentar novamente",
  inicio: "Ir para o início",
  /** Prefixo da referência técnica. Ver a política de digest em `app/error.tsx`. */
  referencia: "Referência:",
} as const

/**
 * Os textos do 404. Mora aqui pelo mesmo motivo do `ERROR_COPY`: é texto de ERRO que a
 * pessoa lê, e ter um dono só evita que as telas divirjam na primeira revisão de redação.
 *
 * ⚠️ Separado do `ERROR_COPY`, e não uma chave a mais dentro dele, porque as duas telas
 * afirmam FATOS diferentes: erro é "falhou do nosso lado, tente de novo" (transitório,
 * com retry); 404 é "isto não existe" (definitivo, sem retry). Fundi-las produziria um
 * botão "Tentar novamente" numa página que nunca vai aparecer.
 *
 * ⚠️ Nenhuma frase daqui ecoa o caminho pedido. Imprimir o slug/id devolveria ao visitante
 * texto que ele mesmo forneceu, numa página servida pelo app — e o que ele digitou não
 * acrescenta nada a quem já sabe o que digitou.
 */
export const NOT_FOUND_COPY = {
  titulo: "Página não encontrada",
  descricao:
    "O endereço não existe ou a obra saiu do catálogo. Verifique o link ou volte para o início.",
  inicio: "Ir para o início",
  catalogo: "Ver o catálogo",
} as const
