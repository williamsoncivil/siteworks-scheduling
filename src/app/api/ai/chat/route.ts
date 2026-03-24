import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type HistoryMessage = { role: "user" | "assistant"; content: string };
type PendingFile = { url: string; name: string; type: string };

type Action =
  | { type: "create_job"; name: string; address: string }
  | {
      type: "create_phase";
      phaseName: string;
      jobId: string | null;
      jobName: string;
      startDate: string | null;
      endDate: string | null;
    }
  | {
      type: "schedule_phase";
      phaseId: string | null;
      phaseName: string;
      jobId: string | null;
      jobName: string;
      startDate: string | null;
      endDate: string | null;
    }
  | {
      type: "assign_worker";
      userId: string | null;
      userName: string;
      phaseId: string | null;
      phaseName: string;
      jobId: string | null;
      jobName: string;
      startDate: string;
      endDate: string;
    }
  | {
      type: "progress_update";
      phaseId: string | null;
      phaseName: string;
      jobName: string;
      notes: string;
    }
  | { type: "question" }
  | { type: "unknown"; reason: string };

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
          return `    - ${p.name} (${start} → ${end}) [phaseId: ${p.id}]`;
        })
        .join("\n");
      return `Job: "${j.name}" [jobId: ${j.id}]\n${phases || "    (no phases)"}`;
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

  // Handle file upload identification (unchanged)
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

  const ctx = await buildScheduleContext();
  const { today, jobsContext, scheduleContext, overdueContext, usersContext, users, activeJobs } = ctx;
  const askingUser = users.find((u) => u.email === session.user?.email);
  const todayStr = today.toISOString().split("T")[0];

  // Build a compact job+phase list for intent parsing (include dates so LLM can reuse them)
  const jobPhaseIndex = activeJobs.map((j) => ({
    id: j.id,
    name: j.name,
    phases: j.phases.map((p) => ({
      id: p.id,
      name: p.name,
      startDate: p.startDate ? p.startDate.toISOString().split("T")[0] : null,
      endDate: p.endDate ? p.endDate.toISOString().split("T")[0] : null,
    })),
  }));

  // Single LLM call: parse ALL intents from the message
  const parseCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a construction scheduling assistant for Williamson Civil Construction.
Parse the user's message and extract ALL requested actions. Interpret the intent generously — the message may be garbled by autocorrect or typos.

Today's date: ${todayStr}

Active jobs and phases (use these IDs when referencing existing jobs/phases):
${JSON.stringify(jobPhaseIndex, null, 2)}

FUZZY MATCHING RULES:
- Interpret autocorrect mangling liberally. Examples: "out of phase" → "add a phase", "out a phase" → "add a phase", "phase" could mean add/create
- Match job and phase names case-insensitively and approximately (e.g. "vacation" matches a job named "Vacation")
- "create" / "make" / "add" / "build" / "new" / "start" all mean create

Return a JSON object: { "actions": [...] }

Each action has a "type" field. Supported types:

create_job — Create a new job:
{ "type": "create_job", "name": "<job name>", "address": "<address or empty string>" }

create_phase — Add a phase to a job:
{ "type": "create_phase", "phaseName": "<phase name>", "jobId": "<job id or null if job is being created in same message>", "jobName": "<job name>", "startDate": "<YYYY-MM-DD or null>", "endDate": "<YYYY-MM-DD or null>" }

schedule_phase — Set dates on an existing phase (use phaseId if known):
{ "type": "schedule_phase", "phaseId": "<phase id or null>", "phaseName": "<phase name>", "jobId": "<job id or null>", "jobName": "<job name>", "startDate": "<YYYY-MM-DD or null>", "endDate": "<YYYY-MM-DD or null>" }

assign_worker — Assign a person (create ScheduleEntry records) to a job/phase for a date range:
{ "type": "assign_worker", "userId": "<user id or null>", "userName": "<user name>", "phaseId": "<phase id or null>", "phaseName": "<phase name>", "jobId": "<job id or null>", "jobName": "<job name>", "startDate": "<YYYY-MM-DD>", "endDate": "<YYYY-MM-DD>" }

IMPORTANT DISTINCTION:
- "schedule phase X for April 6-10" → schedule_phase (update phase dates)
- "schedule Tom for phase X" / "assign Tom to phase X" / "put Tom on phase X" → assign_worker (create schedule entries for Tom)
- A message can contain BOTH: "create phase X for April 6-10 and schedule Tom for it" → create_phase + assign_worker
- When assigning a worker and no dates are provided, use the phase's existing startDate/endDate from the job/phase index above — do NOT leave them null

progress_update — Log a progress note on a phase:
{ "type": "progress_update", "phaseId": "<phase id or null>", "phaseName": "<phase name>", "jobName": "<job name>", "notes": "<note text>" }

question — User is asking a question (answer it using schedule data, no DB changes):
{ "type": "question" }

unknown — Cannot determine intent:
{ "type": "unknown", "reason": "<brief reason>" }

DATE PARSING RULES (always output YYYY-MM-DD):
- "week of [date]" = that Monday through Sunday (e.g. "week of April 6" = 2026-04-06 to 2026-04-12)
- "next week" = next Monday through Sunday from today (${todayStr})
- "[Month] [Day]-[Day]" = e.g. April 6-10 = 2026-04-06 to 2026-04-10
- When only a start date is given with no end, infer end = start + 4 days (5-day work week)

MULTI-STEP INSTRUCTIONS:
- If a message asks to create a job AND add a phase AND schedule it, return 3 actions in order
- For a newly created job's phase, set jobId to null in create_phase — it will be resolved at runtime
- If a phase is created with dates in the same step, put the dates in create_phase (don't add a separate schedule_phase)

Return ONLY the JSON object, no extra text.`,
      },
      { role: "user", content: message },
    ],
    response_format: { type: "json_object" },
  });

  let actions: Action[] = [];
  try {
    const parsed = JSON.parse(parseCompletion.choices[0].message.content ?? "{}");
    actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  } catch {
    actions = [{ type: "unknown", reason: "Failed to parse intent" }];
  }

  if (actions.length === 0) {
    actions = [{ type: "unknown", reason: "No actions found" }];
  }

  // If it's purely a question, route to Q&A
  if (actions.length === 1 && actions[0].type === "question") {
    const systemPrompt = `You are a helpful construction scheduling assistant for Williamson Civil Construction. Answer the user's question using the schedule data below. Be concise and use line breaks to keep it readable.

Today's date: ${todayStr}
${askingUser ? `The person asking: ${askingUser.name}` : ""}

ACTIVE JOBS AND PHASES:
${jobsContext || "No active jobs."}

SCHEDULE ENTRIES (next 14 days):
${scheduleContext || "No upcoming schedule entries."}

POTENTIALLY OVERDUE PHASES (end date has passed, job still active):
${overdueContext || "None."}

TEAM MEMBERS:
${usersContext}`;

    const qaMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam)),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: qaMessages,
    });

    const reply = completion.choices[0].message.content ?? "Sorry, I couldn't generate an answer.";
    return NextResponse.json({ reply });
  }

  // Execute all actions sequentially
  const summaryLines: string[] = [];
  // Track jobs created in this message so subsequent phase actions can reference them
  const createdJobsByName: Record<string, string> = {}; // name.toLowerCase() → id

  for (const action of actions) {
    if (action.type === "question") {
      // Mixed message — skip the Q&A part; mutations take priority
      continue;
    }

    if (action.type === "unknown") {
      summaryLines.push(`⚠️ Couldn't understand part of your request: ${action.reason}`);
      continue;
    }

    if (action.type === "create_job") {
      if (!action.name) {
        summaryLines.push("⚠️ Skipped job creation — no job name found.");
        continue;
      }
      try {
        const newJob = await prisma.job.create({
          data: {
            name: action.name,
            address: action.address || "TBD",
            color: "#3B82F6",
          },
        });
        createdJobsByName[action.name.toLowerCase()] = newJob.id;
        summaryLines.push(`✅ Created job **${newJob.name}**`);
      } catch (err) {
        console.error("create_job error", err);
        summaryLines.push(`❌ Failed to create job "${action.name}"`);
      }
      continue;
    }

    if (action.type === "create_phase") {
      if (!action.phaseName) {
        summaryLines.push("⚠️ Skipped phase creation — no phase name found.");
        continue;
      }
      // Resolve jobId: might be null if the job was just created above
      let jobId = action.jobId;
      if (!jobId && action.jobName) {
        jobId = createdJobsByName[action.jobName.toLowerCase()] ?? null;
        // Also search existing jobs by fuzzy name
        if (!jobId) {
          const match = activeJobs.find(
            (j) => j.name.toLowerCase() === action.jobName.toLowerCase()
          );
          jobId = match?.id ?? null;
        }
      }
      if (!jobId) {
        summaryLines.push(`⚠️ Couldn't find job "${action.jobName}" for phase "${action.phaseName}". Phase not created.`);
        continue;
      }
      try {
        const maxPhase = await prisma.phase.findFirst({
          where: { jobId },
          orderBy: { orderIndex: "desc" },
        });
        const newPhase = await prisma.phase.create({
          data: {
            name: action.phaseName,
            orderIndex: (maxPhase?.orderIndex ?? -1) + 1,
            jobId,
            ...(action.startDate ? { startDate: new Date(action.startDate) } : {}),
            ...(action.endDate ? { endDate: new Date(action.endDate) } : {}),
          },
        });
        const dateStr =
          action.startDate && action.endDate
            ? ` (${action.startDate} → ${action.endDate})`
            : "";
        const jobLabel = action.jobName;
        summaryLines.push(`✅ Created phase **${newPhase.name}** in **${jobLabel}**${dateStr}`);
      } catch (err) {
        console.error("create_phase error", err);
        summaryLines.push(`❌ Failed to create phase "${action.phaseName}"`);
      }
      continue;
    }

    if (action.type === "schedule_phase") {
      // Resolve phaseId
      let phaseId = action.phaseId;
      if (!phaseId) {
        // Search by name within the job
        const jobId = action.jobId ?? activeJobs.find(
          (j) => j.name.toLowerCase() === action.jobName?.toLowerCase()
        )?.id;
        if (jobId) {
          const job = activeJobs.find((j) => j.id === jobId);
          const match = job?.phases.find(
            (p) => p.name.toLowerCase() === action.phaseName.toLowerCase()
          );
          phaseId = match?.id ?? null;
        }
        // Also check phases just created in this message
        if (!phaseId) {
          const recentPhase = await prisma.phase.findFirst({
            where: {
              name: { equals: action.phaseName, mode: "insensitive" },
              jobId: action.jobId ?? undefined,
            },
            orderBy: { orderIndex: "desc" },
          });
          phaseId = recentPhase?.id ?? null;
        }
      }
      if (!phaseId) {
        summaryLines.push(`⚠️ Couldn't find phase "${action.phaseName}" to schedule.`);
        continue;
      }
      // Fall back to existing phase dates if LLM didn't provide them
      let startDate = action.startDate;
      let endDate = action.endDate;
      if (!startDate || !endDate) {
        const existingPhase = activeJobs.flatMap((j) => j.phases).find((p) => p.id === phaseId);
        if (existingPhase) {
          startDate = startDate ?? (existingPhase.startDate ? existingPhase.startDate.toISOString().split("T")[0] : null);
          endDate = endDate ?? (existingPhase.endDate ? existingPhase.endDate.toISOString().split("T")[0] : null);
        }
      }
      if (!startDate || !endDate) {
        summaryLines.push(`⚠️ Skipped scheduling "${action.phaseName}" — no dates provided or found.`);
        continue;
      }
      try {
        await prisma.phase.update({
          where: { id: phaseId },
          data: {
            startDate: new Date(startDate),
            endDate: new Date(endDate),
          },
        });
        summaryLines.push(`✅ Scheduled **${action.phaseName}** (${startDate} → ${endDate})`);
      } catch (err) {
        console.error("schedule_phase error", err);
        summaryLines.push(`❌ Failed to schedule phase "${action.phaseName}"`);
      }
      continue;
    }

    if (action.type === "assign_worker") {
      // Resolve userId from userName (fuzzy match)
      let userId = action.userId;
      if (!userId && action.userName) {
        const match = users.find(
          (u) =>
            u.name.toLowerCase().includes(action.userName.toLowerCase()) ||
            action.userName.toLowerCase().includes(u.name.toLowerCase().split(" ")[0])
        );
        userId = match?.id ?? null;
      }
      if (!userId) {
        summaryLines.push(`⚠️ Couldn't find user "${action.userName}" to schedule.`);
        continue;
      }

      // Resolve phaseId
      let phaseId = action.phaseId;
      if (!phaseId) {
        const jobId = action.jobId ?? activeJobs.find(
          (j) => j.name.toLowerCase() === action.jobName?.toLowerCase()
        )?.id;
        if (jobId) {
          const job = activeJobs.find((j) => j.id === jobId);
          const match = job?.phases.find(
            (p) => p.name.toLowerCase() === action.phaseName.toLowerCase()
          );
          phaseId = match?.id ?? null;
        }
        if (!phaseId) {
          const recentPhase = await prisma.phase.findFirst({
            where: {
              name: { equals: action.phaseName, mode: "insensitive" },
              jobId: action.jobId ?? undefined,
            },
            orderBy: { orderIndex: "desc" },
          });
          phaseId = recentPhase?.id ?? null;
        }
      }

      // Resolve dates — if not provided, use phase's existing dates
      let startDate = action.startDate;
      let endDate = action.endDate;
      if ((!startDate || !endDate) && phaseId) {
        const phase = activeJobs.flatMap((j) => j.phases).find((p) => p.id === phaseId);
        if (phase?.startDate) startDate = startDate || phase.startDate.toISOString().split("T")[0];
        if (phase?.endDate) endDate = endDate || phase.endDate.toISOString().split("T")[0];
      }
      if (!startDate || !endDate) {
        summaryLines.push(`⚠️ No dates for scheduling ${action.userName} — provide a date range.`);
        continue;
      }

      // Resolve jobId for ScheduleEntry (required field)
      const resolvedJobId = action.jobId ??
        activeJobs.find((j) => j.name.toLowerCase() === action.jobName?.toLowerCase())?.id ??
        (phaseId ? activeJobs.find((j) => j.phases.some((p) => p.id === phaseId))?.id : null);
      if (!resolvedJobId) {
        summaryLines.push(`⚠️ Couldn't resolve job for "${action.phaseName}" — worker not scheduled.`);
        continue;
      }

      // Create one ScheduleEntry per working day (Mon–Fri)
      const start = new Date(startDate + "T12:00:00Z");
      const end = new Date(endDate + "T12:00:00Z");
      let count = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) {
          await prisma.scheduleEntry.create({
            data: {
              date: new Date(cur),
              userId,
              jobId: resolvedJobId,
              startTime: "",
              endTime: "",
              ...(phaseId ? { phaseId } : {}),
            },
          });
          count++;
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }

      const user = users.find((u) => u.id === userId);
      summaryLines.push(
        `✅ Assigned **${user?.name ?? action.userName}** to **${action.phaseName || action.jobName}** for ${count} day(s) (${startDate} → ${endDate})`
      );
      continue;
    }

    if (action.type === "progress_update") {
      // Resolve phaseId
      let phaseId = action.phaseId;
      if (!phaseId) {
        const job = activeJobs.find(
          (j) => j.name.toLowerCase() === action.jobName?.toLowerCase()
        );
        const match = job?.phases.find(
          (p) => p.name.toLowerCase() === action.phaseName.toLowerCase()
        );
        phaseId = match?.id ?? null;
      }
      if (!phaseId) {
        summaryLines.push(`⚠️ Couldn't match phase "${action.phaseName}" for progress update.`);
        continue;
      }
      try {
        const phase = activeJobs
          .flatMap((j) => j.phases.map((p) => ({ ...p, jobId: j.id })))
          .find((p) => p.id === phaseId);
        if (phase) {
          await prisma.productionLog.create({
            data: {
              date: new Date(),
              metricName: "Progress Update",
              value: 0,
              unit: "note",
              notes: action.notes,
              jobId: phase.jobId,
              phaseId,
            },
          });
          summaryLines.push(`✅ Logged update for **${action.phaseName}**: ${action.notes}`);
        }
      } catch (err) {
        console.error("progress_update error", err);
        summaryLines.push(`❌ Failed to log update for "${action.phaseName}"`);
      }
      continue;
    }
  }

  if (summaryLines.length === 0) {
    return NextResponse.json({
      reply:
        "I wasn't sure what to do with that. Try something like:\n• \"Create a job called Bridge St\"\n• \"Add a phase called Excavation to Bridge St, schedule it for the week of April 6\"\n• \"What's on the schedule this week?\"",
    });
  }

  return NextResponse.json({ reply: summaryLines.join("\n") });
}
