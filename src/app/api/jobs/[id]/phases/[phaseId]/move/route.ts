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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; phaseId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { startDate, endDate, preview = false } = body;

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  const { phaseId, id: jobId } = params;

  // Get existing phase
  const existing = await prisma.phase.findUnique({ where: { id: phaseId } });
  if (!existing) {
    return NextResponse.json({ error: "Phase not found" }, { status: 404 });
  }

  const newStart = new Date(startDate);
  const newEnd = new Date(endDate);
  const oldEnd = existing.endDate;

  // Calculate cascade
  const updatedPhases: unknown[] = [];
  const conflicts: unknown[] = [];

  if (oldEnd) {
    const deltaDays = differenceInDays(newEnd, oldEnd);
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

        // Check for schedule conflicts
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

          for (const entry of phaseSchedules) {
            const otherEntries = await prisma.scheduleEntry.findMany({
              where: {
                userId: entry.userId,
                jobId: { not: jobId },
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

        if (!preview) {
          const saved = await prisma.phase.update({
            where: { id: depId },
            data: {
              ...(newDepStart && { startDate: newDepStart }),
              ...(newDepEnd && { endDate: newDepEnd }),
            },
          });
          updatedPhases.push(saved);
        } else {
          updatedPhases.push({
            ...dep,
            startDate: newDepStart?.toISOString() ?? dep.startDate,
            endDate: newDepEnd?.toISOString() ?? dep.endDate,
          });
        }
      }
    }
  }

  // Save or return preview for the main phase
  let phase;
  if (!preview) {
    phase = await prisma.phase.update({
      where: { id: phaseId },
      data: { startDate: newStart, endDate: newEnd },
    });
  } else {
    phase = { ...existing, startDate: newStart.toISOString(), endDate: newEnd.toISOString() };
  }

  return NextResponse.json({ phase, updatedPhases, conflicts, preview });
}
