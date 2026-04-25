import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmailNotificationLevel, PushNotificationLevel } from "@prisma/client";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, phone: true, emailNotificationLevel: true, pushNotificationLevel: true, telegramChatId: true, endOfDayPrompt: true },
  });

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const data: {
    emailNotificationLevel?: EmailNotificationLevel;
    pushNotificationLevel?: PushNotificationLevel;
    phone?: string | null;
    telegramChatId?: string | null;
    endOfDayPrompt?: boolean;
    name?: string;
    email?: string;
    passwordHash?: string;
  } = {};

  if (body.emailNotificationLevel && Object.values(EmailNotificationLevel).includes(body.emailNotificationLevel)) {
    data.emailNotificationLevel = body.emailNotificationLevel as EmailNotificationLevel;
  }
  if (body.pushNotificationLevel && Object.values(PushNotificationLevel).includes(body.pushNotificationLevel)) {
    data.pushNotificationLevel = body.pushNotificationLevel as PushNotificationLevel;
  }
  if ("phone" in body) data.phone = body.phone ?? null;
  if ("telegramChatId" in body) data.telegramChatId = body.telegramChatId || null;
  if ("endOfDayPrompt" in body) data.endOfDayPrompt = Boolean(body.endOfDayPrompt);
  if ("name" in body && typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if ("email" in body && typeof body.email === "string" && body.email.trim()) {
    data.email = body.email.trim();
  }

  if (body.currentPassword && body.newPassword) {
    const existing = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });
    if (!existing?.passwordHash) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const valid = await bcrypt.compare(body.currentPassword, existing.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, name: true, email: true, role: true, phone: true, emailNotificationLevel: true, pushNotificationLevel: true, telegramChatId: true, endOfDayPrompt: true },
  });

  return NextResponse.json(user);
}
