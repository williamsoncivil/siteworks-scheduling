import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMentionEmail, sendNewMessageEmail } from "@/lib/email";
import { sendPushNotification } from "@/lib/push";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const phaseId = searchParams.get("phaseId");

  const messages = await prisma.message.findMany({
    where: {
      ...(jobId ? { jobId } : {}),
      ...(phaseId ? { phaseId } : {}),
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
      mentions: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { content, jobId, phaseId } = await req.json();
  if (!content?.trim() || !jobId) {
    return NextResponse.json({ error: "Content and jobId required" }, { status: 400 });
  }

  // Parse @mentions: match @Name or @First Last (two words)
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true, email: true, emailNotificationLevel: true, pushNotificationLevel: true, role: true } });
  const mentionedUserIds: string[] = [];

  // Sort by name length desc so "John Smith" matches before "John"
  const sorted = [...allUsers].sort((a, b) => b.name.length - a.name.length);
  const contentLower = content.toLowerCase();
  for (const user of sorted) {
    if (contentLower.includes(`@${user.name.toLowerCase()}`)) {
      if (!mentionedUserIds.includes(user.id) && user.id !== session.user.id) {
        mentionedUserIds.push(user.id);
      }
    }
  }

  const message = await prisma.message.create({
    data: {
      content: content.trim(),
      authorId: session.user.id,
      jobId,
      phaseId: phaseId || null,
      mentions: mentionedUserIds.length > 0 ? {
        create: mentionedUserIds.map((userId) => ({ userId })),
      } : undefined,
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
      mentions: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  // Fetch shared context for notifications once
  const notifJob = await prisma.job.findUnique({ where: { id: jobId }, select: { name: true } });
  const notifPhase = phaseId ? await prisma.phase.findUnique({ where: { id: phaseId }, select: { name: true } }) : null;
  const authorUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  const authorName = authorUser?.name ?? "A teammate";
  const jobName = notifJob?.name ?? jobId;
  const phaseName = notifPhase?.name;
  const pushUrl = `/messages`;

  // Send email + push notifications to mentioned users
  if (mentionedUserIds.length > 0) {
    for (const uid of mentionedUserIds) {
      const mentionedUser = allUsers.find((u) => u.id === uid);
      if (!mentionedUser) continue;

      if (mentionedUser.email && (mentionedUser.emailNotificationLevel === "MENTIONS" || mentionedUser.emailNotificationLevel === "ALL")) {
        sendMentionEmail({
          toEmail: mentionedUser.email,
          toName: mentionedUser.name,
          fromName: authorName,
          messageContent: content.trim(),
          jobName,
          phaseName,
        }).catch(console.error);
      }

      if (mentionedUser.pushNotificationLevel === "MENTIONS" || mentionedUser.pushNotificationLevel === "ALL") {
        sendPushNotification(mentionedUser.id, {
          title: `${authorName} mentioned you`,
          body: `${jobName}${phaseName ? ` → ${phaseName}` : ""}: ${content.trim()}`,
          url: pushUrl,
        }).catch(console.error);
      }
    }
  }

  // Notify all admins with ALL notifications enabled (not the author, not already @mentioned)
  const admins = allUsers.filter(
    (u) =>
      u.role === "ADMIN" &&
      u.id !== session.user.id &&
      !mentionedUserIds.includes(u.id)
  );

  for (const admin of admins) {
    if (admin.email && admin.emailNotificationLevel === "ALL") {
      sendNewMessageEmail({
        toEmail: admin.email,
        toName: admin.name,
        fromName: authorName,
        messageContent: content.trim(),
        jobName,
        phaseName,
      }).catch(console.error);
    }

    if (admin.pushNotificationLevel === "ALL") {
      sendPushNotification(admin.id, {
        title: `New message from ${authorName}`,
        body: `${jobName}${phaseName ? ` → ${phaseName}` : ""}: ${content.trim()}`,
        url: pushUrl,
      }).catch(console.error);
    }
  }

  return NextResponse.json(message, { status: 201 });
}
