import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/session";
import { route, tooMany } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { handleMessage } from "@/lib/nina";

const body = z.object({
  text: z.string().trim().min(1, "Mensagem vazia").max(1000, "Mensagem muito longa"),
  source: z.enum(["TEXT", "VOICE"]).default("TEXT"),
});

export const POST = route("chat", async (req: Request) => {
  const user = await requireUser();
  if (!rateLimit(`chat:${user.id}`, 20, 60_000)) throw tooMany();
  const { text, source } = body.parse(await req.json());
  const result = await handleMessage(getDb(), user, text, source);
  return NextResponse.json(result);
});
