import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ count: 0 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { messagesLastReadAt: true },
  });

  const since = user?.messagesLastReadAt ?? new Date(0);

  const count = await prisma.message.count({
    where: {
      createdAt: { gt: since },
      authorId: { not: session.user.id }, // don't count your own messages
    },
  });

  return NextResponse.json({ count });
}
