import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { blobUrl, fileName, fileType, jobId, phaseId, jobName, phaseName } = await req.json();
  if (!blobUrl || !fileName || !jobId) {
    return NextResponse.json({ error: "blobUrl, fileName, and jobId are required" }, { status: 400 });
  }

  const fileCategory = (fileType || "").startsWith("image/") ? "photo" : "document";

  const document = await prisma.document.create({
    data: {
      name: fileName,
      fileUrl: blobUrl,
      fileType: fileType || "application/octet-stream",
      fileCategory,
      uploadedById: session.user.id,
      jobId,
      phaseId: phaseId || null,
    },
  });

  return NextResponse.json({
    document,
    reply: `✅ Saved to ${jobName}${phaseName ? ` — ${phaseName}` : ""}!`,
  });
}
