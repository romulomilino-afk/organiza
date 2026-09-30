/** Dinheiro sempre em centavos (inteiro) no banco. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const METHOD_LABEL: Record<string, string> = {
  CARTAO: "Cartão", PIX: "Pix", DINHEIRO: "Dinheiro", DEBITO: "Débito", BOLETO: "Boleto",
};
