import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/errors";
import { answerSuggestion } from "@/lib/nina";

const body = z.object({ messageId: z.string().min(1).max(64), accept: z.boolean() });

export const POST = route("chat.suggestion", async (req: Request) => {
  const user = await requireUser();
  const { messageId, accept } = body.parse(await req.json());
  return NextResponse.json(await answerSuggestion(getDb(), user, messageId, accept));
});
