import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { put } from "@vercel/blob";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function sendTelegramMessage(chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function classifyMessage(text: string): Promise<"question" | "update"> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          'Classify this message as either "question" (asking about the schedule) or "update" (reporting progress on work). Reply with only one word: question or update.',
      },
      { role: "user", content: text },
    ],
  });
  const result = completion.choices[0].message.content?.trim().toLowerCase();
  return result === "question" ? "question" : "update";
}

async function handleQuestion(
  chatId: string,
  text: string,
  userId: string | null
): Promise<string> {
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
            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
              orderIndex: true,
            },
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
        where: {
          job: { status: "ACTIVE" },
          endDate: { lt: today },
        },
        include: { job: { select: { name: true } } },
        take: 50,
      }),
      prisma.user.findMany({
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const jobsContext = activeJobs
    .map((j) => {
      const phases = j.phases
        .map((p) => {
          const start = p.startDate
            ? p.startDate.toISOString().split("T")[0]
            : "no start";
          const end = p.endDate
            ? p.endDate.toISOString().split("T")[0]
            : "no end";
          return `    - ${p.name} (${start} → ${end})`;
        })
        .join("\n");
      return `Job: "${j.name}"\n${phases || "    (no phases)"}`;
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

  const usersContext = users
    .map((u) => `- ${u.name} (${u.role})`)
    .join("\n");

  const askingUser = userId
    ? users.find((u) => u.id === userId)?.name ?? null
    : null;

  const systemPrompt = `You are a helpful construction scheduling assistant for Williamson Civil Construction. Answer the user's question using the schedule data below. Be concise and formatted for Telegram (use line breaks, keep it readable, use emojis sparingly).

Today's date: ${today.toISOString().split("T")[0]}
${askingUser ? `The person asking: ${askingUser}` : ""}

ACTIVE JOBS AND PHASES:
${jobsContext || "No active jobs."}

SCHEDULE ENTRIES (next 14 days):
${scheduleContext || "No upcoming schedule entries."}

POTENTIALLY OVERDUE PHASES (end date has passed, job still active):
${overdueContext || "None."}

TEAM MEMBERS:
${usersContext}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
  });

  return completion.choices[0].message.content ?? "Sorry, I couldn't generate an answer.";
}

async function identifyJobPhase(
  caption: string,
  fileName: string
): Promise<{
  jobId: string | null;
  jobName: string | null;
  phaseId: string | null;
  phaseName: string | null;
  confidence: "high" | "medium" | "low";
}> {
  const activeJobs = await prisma.job.findMany({
    where: { status: "ACTIVE" },
    include: {
      phases: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const jobPhaseList = activeJobs.flatMap((j) =>
    j.phases.map((p) => ({
      jobId: j.id,
      jobName: j.name,
      phaseId: p.id,
      phaseName: p.name,
    }))
  ).slice(0, 80);

  const completion = await openai.chat.completions.create({
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
          ? `File name: ${fileName}\nCaption: ${caption}`
          : `File name: ${fileName}\n(No caption provided)`,
      },
    ],
    response_format: { type: "json_object" },
  });

  try {
    return JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch {
    return { jobId: null, jobName: null, phaseId: null, phaseName: null, confidence: "low" };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message;
    if (!message?.chat?.id) {
      return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);

    // Handle text commands first
    const text: string = message.text ?? "";

    if (text.startsWith("/start")) {
      await sendTelegramMessage(
        chatId,
        `Hi! I'm the Siteworks scheduling bot. Your chat ID is: ${chatId}\n\nEnter this in your Siteworks settings to receive end-of-day prompts.\n\nYou can also ask me schedule questions like "What's scheduled this week?", send progress updates, or send photos/files with a caption to file them under a job.`
      );
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/help")) {
      await sendTelegramMessage(
        chatId,
        `You can ask me schedule questions, send progress updates, or send photos/files.\n\nExamples:\n• "What's scheduled this week?"\n• "Who's working tomorrow?"\n• "What phases are blocked?"\n• "Grading phase is complete"\n• Send a photo with caption "West Alder drainage"`
      );
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith("/")) {
      return NextResponse.json({ ok: true });
    }

    // Look up user by telegramChatId
    const user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
    });

    // Check for pending upload awaiting confirmation
    const pendingUpload = await prisma.pendingUpload.findFirst({
      where: { chatId },
      orderBy: { createdAt: "desc" },
    });

    if (pendingUpload && text) {
      const normalized = text.trim().toLowerCase();

      // YES — confirm and save
      if (normalized === "yes" || normalized === "y") {
        if (!pendingUpload.jobId) {
          await sendTelegramMessage(
            chatId,
            "I don't have a job/phase for this file yet. Which job and phase should I file it under?"
          );
          return NextResponse.json({ ok: true });
        }

        const adminUser = await prisma.user.findFirst({
          where: { role: "ADMIN" },
          orderBy: { createdAt: "asc" },
        });

        const fileCategory = pendingUpload.fileType === "photo" ? "photo" : "document";
        await prisma.document.create({
          data: {
            name: pendingUpload.fileName,
            fileUrl: pendingUpload.blobUrl,
            fileType: pendingUpload.fileType === "photo" ? "image/jpeg" : "application/octet-stream",
            fileCategory,
            uploadedById: user?.id ?? adminUser!.id,
            jobId: pendingUpload.jobId,
            phaseId: pendingUpload.phaseId ?? null,
          },
        });

        await prisma.pendingUpload.delete({ where: { id: pendingUpload.id } });
        await sendTelegramMessage(
          chatId,
          `✅ Saved to ${pendingUpload.jobName}${pendingUpload.phaseName ? ` — ${pendingUpload.phaseName}` : ""}!`
        );
        return NextResponse.json({ ok: true });
      }

      // NO — cancel
      if (normalized === "no" || normalized === "n" || normalized === "cancel") {
        await prisma.pendingUpload.delete({ where: { id: pendingUpload.id } });
        await sendTelegramMessage(
          chatId,
          "Cancelled. Send the file again with a clearer description if you'd like to try again."
        );
        return NextResponse.json({ ok: true });
      }

      // Otherwise treat text as clarification for job/phase
      if (!pendingUpload.jobId) {
        try {
          const identified = await identifyJobPhase(text, pendingUpload.fileName);
          if (
            (identified.confidence === "high" || identified.confidence === "medium") &&
            identified.jobId
          ) {
            await prisma.pendingUpload.update({
              where: { id: pendingUpload.id },
              data: {
                jobId: identified.jobId,
                jobName: identified.jobName,
                phaseId: identified.phaseId,
                phaseName: identified.phaseName,
              },
            });
            await sendTelegramMessage(
              chatId,
              `Got it! Save this ${pendingUpload.fileType} to:\n📁 Job: ${identified.jobName}\n📋 Phase: ${identified.phaseName ?? "No specific phase"}\n\nReply yes to confirm or no to cancel.`
            );
          } else {
            await sendTelegramMessage(
              chatId,
              "I still couldn't match that to a job/phase. Try being more specific, like \"West Alder drainage\"."
            );
          }
        } catch (err) {
          console.error("Re-identification error:", err);
          await sendTelegramMessage(chatId, "Sorry, I had trouble processing that. Please try again.");
        }
        return NextResponse.json({ ok: true });
      }
    }

    // Handle photo/document upload
    const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const hasDocument = !!message.document;

    if (hasPhoto || hasDocument) {
      const fileId = hasPhoto
        ? message.photo[message.photo.length - 1].file_id
        : message.document.file_id;
      const caption: string = message.caption ?? "";
      const fileLabel = hasPhoto ? "photo" : "document";
      const originalFileName = hasDocument
        ? (message.document.file_name ?? `file-${Date.now()}`)
        : `photo-${Date.now()}.jpg`;

      try {
        // Get file path from Telegram
        const fileInfoRes = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`
        );
        const fileInfo = await fileInfoRes.json();
        const filePath: string = fileInfo.result?.file_path;

        if (!filePath) {
          await sendTelegramMessage(chatId, "Sorry, I couldn't retrieve your file. Please try again.");
          return NextResponse.json({ ok: true });
        }

        // Download the file
        const fileRes = await fetch(
          `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`
        );
        const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

        const contentType = hasPhoto
          ? "image/jpeg"
          : (message.document?.mime_type ?? "application/octet-stream");

        // Upload to Vercel Blob
        const blob = await put(
          `telegram-uploads/${Date.now()}-${originalFileName}`,
          fileBuffer,
          {
            access: "public",
            token: process.env.BLOB_READ_WRITE_TOKEN,
            contentType,
          }
        );

        // Identify job/phase from caption
        const identified = await identifyJobPhase(caption, originalFileName);

        if (
          (identified.confidence === "high" || identified.confidence === "medium") &&
          identified.jobId
        ) {
          // Save pending upload with job/phase
          await prisma.pendingUpload.create({
            data: {
              id: `pu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              chatId,
              blobUrl: blob.url,
              fileName: originalFileName,
              fileType: fileLabel,
              jobId: identified.jobId,
              phaseId: identified.phaseId,
              jobName: identified.jobName,
              phaseName: identified.phaseName,
            },
          });
          await sendTelegramMessage(
            chatId,
            `Got it! Save this ${fileLabel} to:\n📁 Job: ${identified.jobName}\n📋 Phase: ${identified.phaseName ?? "No specific phase"}\n\nReply yes to confirm or no to cancel.`
          );
        } else {
          // Save pending upload without job/phase
          await prisma.pendingUpload.create({
            data: {
              id: `pu_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              chatId,
              blobUrl: blob.url,
              fileName: originalFileName,
              fileType: fileLabel,
            },
          });
          await sendTelegramMessage(
            chatId,
            `I received your ${fileLabel} but couldn't tell which job/phase it belongs to. Which job and phase should I file it under?`
          );
        }
      } catch (err) {
        console.error("File upload error:", err);
        await sendTelegramMessage(
          chatId,
          "Sorry, I had trouble processing your file. Please try again."
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Text-only messages below
    if (!text) {
      return NextResponse.json({ ok: true });
    }

    // Classify message as question or update
    let messageType: "question" | "update";
    try {
      messageType = await classifyMessage(text);
    } catch (err) {
      console.error("Classification error:", err);
      messageType = "update";
    }

    // Handle QUESTIONS
    if (messageType === "question") {
      try {
        const answer = await handleQuestion(chatId, text, user?.id ?? null);
        const tip =
          !user
            ? "\n\n💡 Tip: Link your Telegram in Siteworks Settings to get personalized schedule updates!"
            : "";
        await sendTelegramMessage(chatId, answer + tip);
      } catch (err) {
        console.error("Question handling error:", err);
        await sendTelegramMessage(
          chatId,
          "Sorry, I had trouble fetching schedule data. Please try again."
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Handle UPDATES — requires linked account
    if (!user) {
      await sendTelegramMessage(
        chatId,
        "I don't recognize this Telegram account. Please link it in your Siteworks settings to send progress updates.\n\n💡 You can still ask me schedule questions like \"What's scheduled this week?\""
      );
      return NextResponse.json({ ok: true });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const phases = await prisma.phase.findMany({
      where: {
        job: { status: "ACTIVE" },
        startDate: { lte: new Date() },
        endDate: { gte: today },
      },
      include: { job: { select: { id: true, name: true } } },
      take: 30,
    });

    const phaseContext = phases
      .map(
        (p) =>
          `- Phase ID: ${p.id}, Job: "${p.job.name}", Phase: "${p.name}"`
      )
      .join("\n");

    let parsedUpdates: {
      phaseId: string;
      jobName: string;
      phaseName: string;
      notes: string;
    }[] = [];

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a construction scheduling assistant. Parse the user's progress update message and match it to the relevant phases below.

Active phases:
${phaseContext || "No active phases found."}

Return a JSON object with this structure:
{
  "updates": [
    { "phaseId": "<id>", "jobName": "<name>", "phaseName": "<name>", "notes": "<parsed progress note>" }
  ]
}

Only include phases that are clearly mentioned or can be inferred. If nothing matches, return { "updates": [] }.`,
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(
        completion.choices[0].message.content ?? "{}"
      );
      parsedUpdates = parsed.updates ?? [];
    } catch (err) {
      console.error("OpenAI parse error:", err);
      await sendTelegramMessage(
        chatId,
        "Got your message! I had trouble parsing it automatically — please update the schedule manually."
      );
      return NextResponse.json({ ok: true });
    }

    if (parsedUpdates.length === 0) {
      await sendTelegramMessage(
        chatId,
        "Got your message! I couldn't match it to any active phases — please update the schedule manually."
      );
      return NextResponse.json({ ok: true });
    }

    const updateSummary: string[] = [];
    for (const update of parsedUpdates) {
      try {
        await prisma.productionLog.create({
          data: {
            date: new Date(),
            metricName: "Progress Update",
            value: 0,
            unit: "note",
            notes: update.notes,
            jobId: phases.find((p) => p.id === update.phaseId)?.job.id ?? "",
            phaseId: update.phaseId,
          },
        });
        updateSummary.push(
          `• ${update.jobName} — ${update.phaseName}: ${update.notes}`
        );
      } catch (err) {
        console.error("Failed to log update for phase", update.phaseId, err);
      }
    }

    const reply =
      updateSummary.length > 0
        ? `Got it! Updated:\n${updateSummary.join("\n")}`
        : "Got your message! I had trouble saving the updates — please check the schedule manually.";

    await sendTelegramMessage(chatId, reply);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: true });
  }
}
