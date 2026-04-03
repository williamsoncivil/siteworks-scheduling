import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Simple helper to send Telegram message
async function sendTelegramAlert(chatId: string | null, message: string) {
  if (!chatId) return;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  } catch (err) {
    console.error("Telegram alert failed", err);
  }
}

export async function POST(req: NextRequest) {
  // Verify this is from cron or internal
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all overdue phases in active jobs
  const overduePhases = await prisma.phase.findMany({
    where: {
      job: { status: "ACTIVE" },
      endDate: { lt: today },
      completion: { lt: 100 }, // Not completed
    },
    include: {
      job: { select: { id: true, name: true } },
      phaseLead: { select: { id: true, name: true, telegramChatId: true } },
    },
  });

  // Group alerts we've already sent (to avoid duplicates)
  const sentAlerts = new Set<string>();

  for (const phase of overduePhases) {
    const daysLate = Math.floor(
      (today.getTime() - new Date(phase.endDate!).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Determine alert level
    let alertLevel = "";
    let emoji = "";
    if (daysLate >= 7) {
      alertLevel = "CRITICAL";
      emoji = "🚨";
    } else if (daysLate >= 3) {
      alertLevel = "MEDIUM";
      emoji = "⚠️";
    } else if (daysLate >= 1) {
      alertLevel = "SOFT";
      emoji = "📋";
    } else {
      continue; // Skip if not yet overdue
    }

    // Determine who to alert
    let recipientChatId: string | null = null;
    let recipientName = "Admin";

    if (phase.phaseLead && phase.phaseLead.telegramChatId) {
      recipientChatId = phase.phaseLead.telegramChatId;
      recipientName = phase.phaseLead.name;
    } else {
      // Fall back to admin — for now, we don't have admin chat ID stored
      // This would need to be configured in env or settings
      recipientChatId = process.env.ADMIN_TELEGRAM_CHAT_ID || null;
    }

    if (!recipientChatId) continue;

    // Avoid duplicate alerts (same phase, same day, same level)
    const alertKey = `${phase.id}_${daysLate}_${alertLevel}`;
    if (sentAlerts.has(alertKey)) continue;
    sentAlerts.add(alertKey);

    // Build message
    let message = "";
    if (alertLevel === "SOFT") {
      message = `${emoji} **${phase.name}** (${phase.job.name}) ended yesterday — check status?\n\nEnded: ${phase.endDate?.toISOString().split("T")[0]}`;
    } else if (alertLevel === "MEDIUM") {
      message = `${emoji} **${phase.name}** (${phase.job.name}) is **${daysLate} days late** — what's the blocker?\n\nEnded: ${phase.endDate?.toISOString().split("T")[0]}`;
    } else if (alertLevel === "CRITICAL") {
      message = `${emoji} **CRITICAL: ${phase.name}** (${phase.job.name}) overdue by **${daysLate} days**!\n\nEnded: ${phase.endDate?.toISOString().split("T")[0]}\n\nUpdate needed immediately.`;
    }

    // Send alert
    await sendTelegramAlert(recipientChatId, message);
  }

  return NextResponse.json({
    success: true,
    phasesChecked: overduePhases.length,
  });
}
