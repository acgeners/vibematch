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
