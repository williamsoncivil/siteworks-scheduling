import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.jobTemplate.findMany({
    where: { userId: session.user.id },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, jobId } = body;

  if (!name || !jobId) {
    return NextResponse.json({ error: "Name and jobId are required" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const template = await prisma.jobTemplate.create({
    data: {
      name,
      description: description || null,
      userId: session.user.id,
      phases: {
        create: job.phases.map((p) => ({
          name: p.name,
          description: p.description,
          orderIndex: p.orderIndex,
          category: p.category,
        })),
      },
    },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
  });

  return NextResponse.json(template, { status: 201 });
}
