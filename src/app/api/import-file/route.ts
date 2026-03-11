import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { put } from "@vercel/blob";

// One-time import token for Buildertrend migration
const IMPORT_TOKEN = "bt-import-2026-williamson";

// Vercel max body is ~4.5MB; above this threshold use chunked upload
const CHUNK_THRESHOLD_BYTES = 3 * 1024 * 1024; // 3MB base64 string

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://buildertrend.net",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, name, b64, contentType, jobName, phaseTitle, blobUrl } = body;

  if (token !== IMPORT_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Find job by name
  const job = await prisma.job.findFirst({ where: { name: jobName } });
  if (!job) {
    return NextResponse.json({ error: `Job not found: ${jobName}` }, { status: 404 });
  }

  // Find phase by title + jobId
  const phase = phaseTitle
    ? await prisma.phase.findFirst({ where: { name: phaseTitle, jobId: job.id } })
    : null;

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const safeName = (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const blobPath = `williamson/${jobName.replace(/[^a-zA-Z0-9]/g, "-")}/${Date.now()}_${safeName}`;

  let finalUrl: string;

  if (blobUrl) {
    // Large file: already uploaded directly to Vercel Blob, just register in DB
    finalUrl = blobUrl;
  } else {
    // Small/medium file: base64 encoded in body
    const buf = Buffer.from(b64, "base64");
    const blob = await put(blobPath, buf, {
      access: "public",
      contentType: contentType || "application/pdf",
    });
    finalUrl = blob.url;
  }

  const doc = await prisma.document.create({
    data: {
      name,
      fileUrl: finalUrl,
      fileType: contentType || "application/pdf",
      fileCategory: (contentType || "").startsWith("image/") ? "photo" : "document",
      uploadedById: adminUser!.id,
      jobId: job.id,
      phaseId: phase?.id || null,
    },
  });

  return NextResponse.json(
    { ok: true, url: finalUrl, docId: doc.id, phaseTitle },
    { status: 201, headers: corsHeaders() }
  );
}
