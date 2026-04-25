import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { templateId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, address, description, color } = body;

  if (!name || !address) {
    return NextResponse.json({ error: "Name and address are required" }, { status: 400 });
  }

  const template = await prisma.jobTemplate.findUnique({
    where: { id: params.templateId },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
  });

  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const newJob = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        name,
        address,
        description: description || null,
        color: color || "#3B82F6",
        status: "ACTIVE",
      },
    });

    for (const phase of template.phases) {
      await tx.phase.create({
        data: {
          name: phase.name,
          description: phase.description,
          orderIndex: phase.orderIndex,
          category: phase.category,
          jobId: job.id,
        },
      });
    }

    return job;
  });

  return NextResponse.json(newJob, { status: 201 });
}
