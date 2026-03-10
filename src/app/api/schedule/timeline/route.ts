import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch all active jobs with their phases and schedule entries (workers)
  const jobs = await prisma.job.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: {
      phases: {
        orderBy: { orderIndex: "asc" },
        include: {
          schedules: {
            distinct: ["userId"],
            orderBy: { createdAt: "asc" },
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      },
    },
  });

  // Also fetch all users who have any schedule entries (to build the color legend)
  const allWorkers = await prisma.user.findMany({
    where: {
      schedules: { some: {} },
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ jobs, allWorkers });
}
