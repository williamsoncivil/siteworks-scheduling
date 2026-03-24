import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type HistoryMessage = { role: "user" | "assistant"; content: string };
type PendingFile = { url: string; name: string; type: string };

async function buildScheduleContext() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in14Days = new Date(today);
  in14Days.setDate(in14Days.getDate() + 14);

  const [activeJobs, scheduleEntries, overdueCandidates, users] =
    await Promise.all([
      prisma.job.findMany({
        where: { status: "ACTIVE" },
        include: {
          phases: {
            select: { id: true, name: true, startDate: true, endDate: true, orderIndex: true },
            orderBy: { orderIndex: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.scheduleEntry.findMany({
        where: { date: { gte: today, lte: in14Days } },
        include: {
          job: { select: { name: true } },
          phase: { select: { name: true } },
          user: { select: { name: true, id: true } },
        },
        orderBy: { date: "asc" },
        take: 200,
      }),
      prisma.phase.findMany({
        where: { job: { status: "ACTIVE" }, endDate: { lt: today } },
        include: { job: { select: { name: true } } },
        take: 50,
      }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const jobsContext = activeJobs
    .map((j) => {
      const phases = j.phases
        .map((p) => {
          const start = p.startDate ? p.startDate.toISOString().split("T")[0] : "no start";
          const end = p.endDate ? p.endDate.toISOString().split("T")[0] : "no end";
          return `    - ${p.name} (${start} → ${end})`;
        })
        .join("\n");
      return `Job: "${j.name}" (ID: ${j.id})\n${phases || "    (no phases)"}`;
    })
    .join("\n\n");

  const scheduleContext = scheduleEntries
    .map((e) => {
      const date = e.date.toISOString().split("T")[0];
      const phase = e.phase ? ` / ${e.phase.name}` : "";
      return `${date}: ${e.user.name} → ${e.job.name}${phase}`;
    })
    .join("\n");

  const overdueContext = overdueCandidates
    .map((p) => {
      const end = p.endDate ? p.endDate.toISOString().split("T")[0] : "?";
      return `- ${p.job.name} / ${p.name} (ended ${end})`;
    })
    .join("\n");

  const usersContext = users.map((u) => `- ${u.name} (${u.role})`).join("\n");

  return { today, jobsContext, scheduleContext, overdueContext, usersContext, users, activeJobs };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const message: string = body.message ?? "";
  const history: HistoryMessage[] = body.history ?? [];
  const pendingFile: PendingFile | null = body.pendingFile ?? null;

  if (!message.trim() && !pendingFile) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // Handle file upload identification
  if (pendingFile) {
    const ctx = await buildScheduleContext();
    const { activeJobs } = ctx;

    const jobPhaseList = activeJobs
      .flatMap((j) =>
        j.phases.map((p) => ({
          jobId: j.id,
          jobName: j.name,
          phaseId: p.id,
          phaseName: p.name,
        }))
      )
      .slice(0, 80);

    const caption = message.trim();

    const identifyCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a construction document filing assistant. Given a file caption and a list of active jobs/phases, identify which job and phase the file belongs to.

Active jobs and phases (JSON):
${JSON.stringify(jobPhaseList, null, 2)}

Return a JSON object:
{
  "jobId": "<id or null>",
  "jobName": "<name or null>",
  "phaseId": "<id or null>",
  "phaseName": "<name or null>",
  "confidence": "high" | "medium" | "low"
}

If there is no caption or you cannot determine the job, set all fields to null and confidence to "low".`,
        },
        {
          role: "user",
          content: caption
            ? `File name: ${pendingFile.name}\nCaption: ${caption}`
            : `File name: ${pendingFile.name}\n(No caption provided)`,
        },
      ],
      response_format: { type: "json_object" },
    });

    let identified: {
      jobId: string | null;
      jobName: string | null;
      phaseId: string | null;
      phaseName: string | null;
      confidence: string;
    } = { jobId: null, jobName: null, phaseId: null, phaseName: null, confidence: "low" };

    try {
      identified = JSON.parse(identifyCompletion.choices[0].message.content ?? "{}");
    } catch {
      // leave as low confidence
    }

    if (
      (identified.confidence === "high" || identified.confidence === "medium") &&
      identified.jobId
    ) {
      return NextResponse.json({
        reply: `Got it! Save this ${pendingFile.type.startsWith("image/") ? "photo" : "file"} to:\n📁 Job: ${identified.jobName}\n📋 Phase: ${identified.phaseName ?? "No specific phase"}\n\nReply "yes" to confirm or "no" to cancel.`,
        confirmUpload: {
          url: pendingFile.url,
          name: pendingFile.name,
          type: pendingFile.type,
          jobId: identified.jobId,
          jobName: identified.jobName,
          phaseId: identified.phaseId,
          phaseName: identified.phaseName,
        },
      });
    } else {
      return NextResponse.json({
        reply: `I received your ${pendingFile.type.startsWith("image/") ? "photo" : "file"} but couldn't tell which job/phase it belongs to. Which job and phase should I file it under?`,
        confirmUpload: {
          url: pendingFile.url,
          name: pendingFile.name,
          type: pendingFile.type,
          jobId: null,
          jobName: null,
          phaseId: null,
          phaseName: null,
        },
      });
    }
  }

  // Classify message
  const classifyCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'Classify this message as "question" (asking about the schedule), "update" (reporting progress on work), or "create" (requesting to create a new job or phase). Reply with only one word: question, update, or create.',
      },
      { role: "user", content: message },
    ],
  });
  const rawType = classifyCompletion.choices[0].message.content?.trim().toLowerCase() ?? "";
  const msgType = rawType === "question" ? "question" : rawType === "create" ? "create" : "update";

  const ctx = await buildScheduleContext();
  const { today, jobsContext, scheduleContext, overdueContext, usersContext, users, activeJobs } = ctx;

  const askingUser = users.find((u) => u.email === session.user?.email);

  // Handle CREATE
  if (msgType === "create") {
    const jobList = activeJobs.map((j) => ({ id: j.id, name: j.name }));

    const parseCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a construction scheduling assistant. Parse the user's request to create a job or phase.

Active jobs (for phase creation):
${JSON.stringify(jobList, null, 2)}

Return a JSON object with one of these shapes:

For creating a job:
{
  "action": "create_job",
  "name": "<job name>",
  "address": "<address or empty string if not provided>"
}

For creating a phase:
{
  "action": "create_phase",
  "phaseName": "<phase name>",
  "jobId": "<job id from the list above>",
  "jobName": "<job name>"
}

If you cannot determine what to create or cannot match a phase to a job, return:
{ "action": "unknown" }`,
        },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
    });

    let parsed: {
      action: string;
      name?: string;
      address?: string;
      phaseName?: string;
      jobId?: string;
      jobName?: string;
    } = { action: "unknown" };

    try {
      parsed = JSON.parse(parseCompletion.choices[0].message.content ?? "{}");
    } catch {
      // fall through to unknown
    }

    if (parsed.action === "create_job") {
      if (!parsed.name) {
        return NextResponse.json({
          reply: "I need a name for the job. What should the job be called?",
        });
      }
      const newJob = await prisma.job.create({
        data: {
          name: parsed.name,
          address: parsed.address || "TBD",
          color: "#3B82F6",
        },
      });
      return NextResponse.json({
        reply: `✅ Created job **${newJob.name}**! You can view and edit it in the Jobs list.`,
      });
    }

    if (parsed.action === "create_phase") {
      if (!parsed.phaseName || !parsed.jobId) {
        return NextResponse.json({
          reply: "I need both a phase name and the job it belongs to. Which job should this phase be added to?",
        });
      }
      const job = await prisma.job.findUnique({ where: { id: parsed.jobId } });
      if (!job) {
        return NextResponse.json({
          reply: `I couldn't find the job "${parsed.jobName}". Please check the job name and try again.`,
        });
      }
      const maxPhase = await prisma.phase.findFirst({
        where: { jobId: parsed.jobId },
        orderBy: { orderIndex: "desc" },
      });
      const newPhase = await prisma.phase.create({
        data: {
          name: parsed.phaseName,
          orderIndex: (maxPhase?.orderIndex ?? -1) + 1,
          jobId: parsed.jobId,
        },
      });
      return NextResponse.json({
        reply: `✅ Created phase **${newPhase.name}** in job **${job.name}**! Open the job to set dates and details.`,
      });
    }

    // Unknown create intent — fall back to a helpful message
    return NextResponse.json({
      reply: "I can create jobs or phases for you. Just say something like \"Create a new job called Riverside Bridge at 123 Main St\" or \"Add a phase called Excavation to the West Alder job\".",
    });
  }

  if (msgType === "question") {
    const systemPrompt = `You are a helpful construction scheduling assistant for Williamson Civil Construction. Answer the user's question using the schedule data below. Be concise and use line breaks to keep it readable.

Today's date: ${today.toISOString().split("T")[0]}
${askingUser ? `The person asking: ${askingUser.name}` : ""}

ACTIVE JOBS AND PHASES:
${jobsContext || "No active jobs."}

SCHEDULE ENTRIES (next 14 days):
${scheduleContext || "No upcoming schedule entries."}

POTENTIALLY OVERDUE PHASES (end date has passed, job still active):
${overdueContext || "None."}

TEAM MEMBERS:
${usersContext}`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = completion.choices[0].message.content ?? "Sorry, I couldn't generate an answer.";
    return NextResponse.json({ reply });
  }

  // Handle UPDATE
  const phases = await prisma.phase.findMany({
    where: {
      job: { status: "ACTIVE" },
      startDate: { lte: new Date() },
      endDate: { gte: today },
    },
    include: { job: { select: { id: true, name: true } } },
    take: 30,
  });

  // Also include all phases from active jobs (not just current ones)
  const allActivePhases = activeJobs.flatMap((j) =>
    j.phases.map((p) => ({ ...p, job: { id: j.id, name: j.name } }))
  );

  const phasePool = phases.length > 0 ? phases : allActivePhases;

  const phaseContext = phasePool
    .map((p) => `- Phase ID: ${p.id}, Job: "${p.job.name}", Phase: "${p.name}"`)
    .join("\n");

  const parseCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a construction scheduling assistant. Parse the user's progress update and match it to the relevant phases below.

Active phases:
${phaseContext || "No active phases found."}

Return a JSON object:
{
  "updates": [
    { "phaseId": "<id>", "jobName": "<name>", "phaseName": "<name>", "notes": "<parsed progress note>" }
  ]
}

Only include phases clearly mentioned or inferable. If nothing matches, return { "updates": [] }.`,
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  let parsedUpdates: { phaseId: string; jobName: string; phaseName: string; notes: string }[] = [];
  try {
    const parsed = JSON.parse(parseCompletion.choices[0].message.content ?? "{}");
    parsedUpdates = parsed.updates ?? [];
  } catch {
    return NextResponse.json({
      reply: "I received your update but had trouble parsing it. Please check the schedule manually.",
    });
  }

  if (parsedUpdates.length === 0) {
    return NextResponse.json({
      reply: "I received your message but couldn't match it to any active phases. Please update the schedule manually if needed.",
    });
  }

  const updateSummary: string[] = [];
  for (const update of parsedUpdates) {
    try {
      const phase = phasePool.find((p) => p.id === update.phaseId);
      if (!phase) continue;
      await prisma.productionLog.create({
        data: {
          date: new Date(),
          metricName: "Progress Update",
          value: 0,
          unit: "note",
          notes: update.notes,
          jobId: phase.job.id,
          phaseId: update.phaseId,
        },
      });
      updateSummary.push(`• ${update.jobName} — ${update.phaseName}: ${update.notes}`);
    } catch (err) {
      console.error("Failed to log update for phase", update.phaseId, err);
    }
  }

  const reply =
    updateSummary.length > 0
      ? `Got it! Logged the following updates:\n${updateSummary.join("\n")}`
      : "I received your update but had trouble saving it. Please check the schedule manually.";

  return NextResponse.json({ reply });
}
