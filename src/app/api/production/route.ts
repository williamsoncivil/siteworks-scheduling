import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseISO } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const logs = await prisma.productionLog.findMany({
    where: { jobId },
    orderBy: { date: "desc" },
    include: {
      phase: { select: { id: true, name: true } },
    },
  });

  // Calculate totals and averages per metric
  const metricsMap: Record<string, { total: number; count: number; unit: string; values: number[] }> = {};
  for (const log of logs) {
    if (!metricsMap[log.metricName]) {
      metricsMap[log.metricName] = { total: 0, count: 0, unit: log.unit, values: [] };
    }
    metricsMap[log.metricName].total += log.value;
    metricsMap[log.metricName].count++;
    metricsMap[log.metricName].values.push(log.value);
  }

  const metrics = Object.entries(metricsMap).map(([name, data]) => ({
    name,
    unit: data.unit,
    total: data.total,
    count: data.count,
    average: data.total / data.count,
  }));

  return NextResponse.json({ logs, metrics });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { jobId, phaseId, date, metricName, value, unit, notes } = body;

  if (!jobId || !date || !metricName || value === undefined || !unit) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const log = await prisma.productionLog.create({
    data: {
      jobId,
      phaseId: phaseId || null,
      date: parseISO(date),
      metricName,
      value: parseFloat(value),
      unit,
      notes: notes || null,
    },
    include: {
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(log, { status: 201 });
}
