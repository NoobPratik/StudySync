import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const reviewSchema = z.object({
  quality: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
});

// SM-2 Spaced Repetition quality mapping: AGAIN=1, HARD=3, GOOD=4, EASY=5
const QUALITY_MAP = {
  AGAIN: 1,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
} as const;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ cardId: string }> },
) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cardId } = await context.params;
  const card = await prisma.flashcard.findFirst({
    where: { id: cardId, deck: { userId: user.id } },
  });

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  }

  const q = QUALITY_MAP[parsed.data.quality];
  let repetitions = card.repetitions;
  let intervalDays = card.intervalDays;
  let easeFactor = card.easeFactor;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 0; // Review again soon
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    repetitions += 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  );

  const now = new Date();
  const nextReviewAt =
    intervalDays === 0
      ? new Date(now.getTime() + 10 * 60 * 1000) // 10 minutes
      : new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.flashcard.update({
    where: { id: card.id },
    data: {
      repetitions,
      intervalDays,
      easeFactor: Number(easeFactor.toFixed(2)),
      nextReviewAt,
      lastReviewedAt: now,
    },
  });

  return NextResponse.json({ card: updated });
}
