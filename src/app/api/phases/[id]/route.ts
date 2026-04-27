import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cascadePhaseUpdate } from "@/lib/cascade";
import { broadcastPhaseUpdated } from "@/lib/socket";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const phase = await prisma.phase.findUnique({
    where: { id: params.id },
    include: {
      predecessorDeps: {
        include: { predecessor: { select: { id: true, name: true } } },
      },
      successorDeps: {
        include: { successor: { select: { id: true, name: true } } },
      },
    },
  });

  if (!phase) return NextResponse.json({ error: "Phase not found" }, { status: 404 });

  return NextResponse.json(phase);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, startDate, endDate, orderIndex, completion, category, phaseLeadId } = body;

  const existing = await prisma.phase.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Phase not found" }, { status: 404 });

  const newStart = startDate !== undefined
    ? (startDate ? new Date(startDate) : null)
    : existing.startDate;
  const newEnd = endDate !== undefined
    ? (endDate ? new Date(endDate) : null)
    : existing.endDate;

  const updatedPhase = await prisma.phase.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(completion !== undefined && { completion: Math.min(100, Math.max(0, parseInt(completion))) }),
      ...(orderIndex !== undefined && { orderIndex }),
      ...(startDate !== undefined && { startDate: newStart }),
      ...(endDate !== undefined && { endDate: newEnd }),
      ...(category !== undefined && { category: category || null }),
      ...(phaseLeadId !== undefined && { phaseLeadId: phaseLeadId || null }),
    },
  });

  // Sync schedule entries to new phase start date. Always sync when startDate is explicitly
  // provided — the old move endpoint may have already updated the phase row, so comparing
  // against existing.startDate would show no change even when the user did change the date.
  if (startDate !== undefined && newStart) {
    await prisma.scheduleEntry.updateMany({
      where: { phaseId: params.id },
      data: { date: newStart },
    });
  }

  // Run cascade whenever dates are explicitly provided (even if already stored — the old move
  // endpoint may have already saved them, so we can't rely on a diff check here)
  let cascadedPhases: Awaited<ReturnType<typeof cascadePhaseUpdate>> = [];
  let cascadeError: string | null = null;
  if ((startDate !== undefined || endDate !== undefined) && (newStart || newEnd)) {
    try {
      cascadedPhases = await cascadePhaseUpdate(params.id, newStart, newEnd);
    } catch (err) {
      console.error("[cascade] cascadePhaseUpdate failed for phase", params.id, err);
      cascadeError = err instanceof Error ? err.message : String(err);
    }
  }

  broadcastPhaseUpdated({
    phaseId: updatedPhase.id,
    jobId: updatedPhase.jobId,
    phase: updatedPhase as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ phase: updatedPhase, cascadedPhases, ...(cascadeError && { cascadeError }) });
}
