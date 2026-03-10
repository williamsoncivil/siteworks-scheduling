import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addDays, differenceInDays, startOfDay, endOfDay } from "date-fns";

function skipWeekend(date: Date): Date {
  const day = date.getDay();
  if (day === 6) return addDays(date, 2); // Saturday → Monday
  if (day === 0) return addDays(date, 1); // Sunday → Monday
  return date;
}

async function walkDependents(phaseId: string): Promise<string[]> {
  const deps: string[] = [];
  const queue = [phaseId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await prisma.phase.findMany({
      where: { dependsOnId: current },
      select: { id: true },
    });
    for (const child of children) {
      deps.push(child.id);
      queue.push(child.id);
    }
  }
  return deps;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phases = await prisma.phase.findMany({
    where: { jobId: params.id },
    orderBy: { orderIndex: "asc" },
  });

  return NextResponse.json(phases);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Get the max orderIndex for the job
  const maxPhase = await prisma.phase.findFirst({
    where: { jobId: params.id },
    orderBy: { orderIndex: "desc" },
  });

  const phase = await prisma.phase.create({
    data: {
      name,
      description: description || null,
      orderIndex: (maxPhase?.orderIndex ?? -1) + 1,
      jobId: params.id,
    },
  });

  return NextResponse.json(phase, { status: 201 });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { phaseId, name, description, orderIndex, startDate, endDate, dependsOnId } = body;

  if (!phaseId) {
    return NextResponse.json({ error: "phaseId is required" }, { status: 400 });
  }

  // Get existing phase to compare endDate
  const existing = await prisma.phase.findUnique({ where: { id: phaseId } });
  if (!existing) {
    return NextResponse.json({ error: "Phase not found" }, { status: 404 });
  }

  const updatedPhase = await prisma.phase.update({
    where: { id: phaseId, jobId: params.id },
    data: {
      ...(name && { name }),
      ...(description !== undefined && { description }),
      ...(orderIndex !== undefined && { orderIndex }),
      ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
      ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
      ...(dependsOnId !== undefined && { dependsOnId: dependsOnId || null }),
    },
  });

  // Cascade if endDate changed
  const updatedPhases: unknown[] = [];
  const conflicts: unknown[] = [];

  const newEndDate = endDate ? new Date(endDate) : null;
  const oldEndDate = existing.endDate;

  if (newEndDate && oldEndDate) {
    const deltaDays = differenceInDays(newEndDate, oldEndDate);
    if (deltaDays !== 0) {
      const dependentIds = await walkDependents(phaseId);
      for (const depId of dependentIds) {
        const dep = await prisma.phase.findUnique({ where: { id: depId } });
        if (!dep) continue;

        const newDepStart = dep.startDate
          ? skipWeekend(addDays(dep.startDate, deltaDays))
          : null;
        const newDepEnd = dep.endDate
          ? skipWeekend(addDays(dep.endDate, deltaDays))
          : null;

        // Check for schedule conflicts in the new date range
        if (newDepStart && newDepEnd) {
          const phaseSchedules = await prisma.scheduleEntry.findMany({
            where: {
              phaseId: depId,
              date: {
                gte: startOfDay(newDepStart),
                lte: endOfDay(newDepEnd),
              },
            },
            include: {
              user: { select: { name: true } },
              job: { select: { name: true } },
            },
          });

          // Check if any of those users are booked elsewhere
          for (const entry of phaseSchedules) {
            const otherEntries = await prisma.scheduleEntry.findMany({
              where: {
                userId: entry.userId,
                jobId: { not: entry.jobId },
                date: {
                  gte: startOfDay(entry.date),
                  lte: endOfDay(entry.date),
                },
              },
              include: { job: { select: { name: true } } },
            });
            if (otherEntries.length > 0) {
              conflicts.push({
                userName: entry.user.name,
                date: entry.date.toISOString().split("T")[0],
                jobName: otherEntries[0].job.name,
                phaseName: dep.name,
              });
            }
          }
        }

        const updatedDep = await prisma.phase.update({
          where: { id: depId },
          data: {
            ...(newDepStart && { startDate: newDepStart }),
            ...(newDepEnd && { endDate: newDepEnd }),
          },
        });
        updatedPhases.push(updatedDep);
      }
    }
  }

  return NextResponse.json({ phase: updatedPhase, updatedPhases, conflicts });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const phaseId = searchParams.get("phaseId");

  if (!phaseId) {
    return NextResponse.json({ error: "phaseId query param required" }, { status: 400 });
  }

  await prisma.phase.delete({ where: { id: phaseId, jobId: params.id } });

  return NextResponse.json({ success: true });
}
