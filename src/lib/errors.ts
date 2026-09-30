import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log } from "./logger";

/** Erro esperado, com mensagem segura para mostrar ao usuário. */
export class AppError extends Error {
  constructor(public status: number, public publicMessage: string, public code = "app_error") {
    super(publicMessage);
  }
}

export const unauthorized = () => new AppError(401, "Faça login para continuar.", "unauthorized");
export const tooMany = (msg = "Muitas mensagens em pouco tempo. Espere um instante.") => new AppError(429, msg, "rate_limited");

/** Envolve um handler de rota: erros inesperados viram 500 genérico, sem vazar detalhes. */
export function route<T extends unknown[]>(name: string, fn: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    const started = Date.now();
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AppError) {
        log.warn("route.handled", { route: name, status: e.status, code: e.code });
        return NextResponse.json({ error: e.publicMessage, code: e.code }, { status: e.status });
      }
      if (e instanceof ZodError) {
        log.warn("route.invalid_input", { route: name, issues: e.issues.length });
        return NextResponse.json({ error: "Dados inválidos.", code: "invalid_input" }, { status: 400 });
      }
      log.error("route.failed", { route: name, error: e as Error, ms: Date.now() - started });
      return NextResponse.json({ error: "Algo deu errado do nosso lado. Tente de novo.", code: "internal" }, { status: 500 });
    }
  };
}
