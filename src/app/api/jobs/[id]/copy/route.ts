import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, address, description } = body;

  if (!name || !address) {
    return NextResponse.json({ error: "Name and address are required" }, { status: 400 });
  }

  // Get source job with its phases
  const sourceJob = await prisma.job.findUnique({
    where: { id: params.id },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
  });

  if (!sourceJob) {
    return NextResponse.json({ error: "Source job not found" }, { status: 404 });
  }

  // Create new job and copy phases in a transaction
  const newJob = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        name,
        address,
        description: description || sourceJob.description,
        color: sourceJob.color,
        status: "ACTIVE",
      },
    });

    // Copy all phases
    for (const phase of sourceJob.phases) {
      await tx.phase.create({
        data: {
          name: phase.name,
          description: phase.description,
          orderIndex: phase.orderIndex,
          jobId: job.id,
        },
      });
    }

    return job;
  });

  return NextResponse.json(newJob, { status: 201 });
}
