import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const message = await prisma.message.create({
    data: {
      content: content.trim(),
      authorId: session.user.id,
      jobId,
      phaseId: phaseId || null,
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      job: { select: { id: true, name: true, color: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(message, { status: 201 });
}
