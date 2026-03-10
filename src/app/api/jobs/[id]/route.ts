import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    include: {
      phases: { orderBy: { orderIndex: "asc" } },
      schedules: {
        orderBy: { date: "desc" },
        take: 20,
        include: {
          user: { select: { id: true, name: true } },
          phase: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: { messages: true, documents: true },
      },
    },
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json(job);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, address, description, status, color } = body;

  const job = await prisma.job.update({
    where: { id: params.id },
    data: {
      ...(name && { name }),
      ...(address && { address }),
      ...(description !== undefined && { description }),
      ...(status && { status }),
      ...(color && { color }),
    },
  });

  return NextResponse.json(job);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.job.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
