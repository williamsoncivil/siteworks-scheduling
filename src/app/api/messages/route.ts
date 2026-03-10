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

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: {
      jobId,
      ...(phaseId ? { phaseId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, role: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { content, jobId, phaseId } = body;

  if (!content || !jobId) {
    return NextResponse.json({ error: "content and jobId are required" }, { status: 400 });
  }

  const message = await prisma.message.create({
    data: {
      content,
      authorId: session.user.id,
      jobId,
      phaseId: phaseId || null,
    },
    include: {
      author: { select: { id: true, name: true, role: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(message, { status: 201 });
}
