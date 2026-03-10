import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const jobId = formData.get("jobId") as string;
  const phaseId = formData.get("phaseId") as string | null;

  if (!file || !jobId) {
    return NextResponse.json({ error: "file and jobId are required" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Ensure uploads directory exists
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  // Create unique filename
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${timestamp}_${safeName}`;
  const filepath = path.join(uploadsDir, filename);

  await writeFile(filepath, buffer);

  const fileUrl = `/uploads/${filename}`;
  const fileType = file.type || "application/octet-stream";

  // Auto-detect category based on MIME type
  const fileCategory = fileType.startsWith("image/") ? "photo" : "document";

  const document = await prisma.document.create({
    data: {
      name: file.name,
      fileUrl,
      fileType,
      fileCategory,
      uploadedById: session.user.id,
      jobId,
      phaseId: phaseId || null,
    },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      phase: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(document, { status: 201 });
}
