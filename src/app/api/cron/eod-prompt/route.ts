import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN_SCHEDULING;
const CRON_SECRET = process.env.CRON_SECRET;

async function sendTelegramMessage(chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Telegram sendMessage failed for ${chatId}:`, body);
  }
}

export async function POST(req: NextRequest) {
  // Vercel crons send: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  // Find opted-in users with a telegram chat ID
  const users = await prisma.user.findMany({
    where: { endOfDayPrompt: true, telegramChatId: { not: null } },
    select: { id: true, name: true, telegramChatId: true },
  });

  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    if (!user.telegramChatId) continue;

    // Fetch phases assigned to this user that are active today
    const scheduleEntries = await prisma.scheduleEntry.findMany({
      where: {
        userId: user.id,
        date: { gte: today, lte: todayEnd },
      },
      include: {
        phase: { include: { job: { select: { name: true } } } },
      },
    });
    const phases = scheduleEntries
      .map(e => e.phase)
      .filter(Boolean)
      .filter(p => p?.job);

    if (phases.length === 0) {
      skipped++;
      continue;
    }

    const phaseList = phases.map(p => `• ${p!.job.name} — ${p!.name}`).join("\n");
    const message = `Hey ${user.name}! 👷 End of day check-in. Here are your active phases today:\n${phaseList}\n\nReply with any progress updates (e.g. "grading is 50% done" or "drainage phase complete")`;

    await sendTelegramMessage(user.telegramChatId, message);
    sent++;
  }

  return NextResponse.json({ ok: true, sent, skipped });
}
