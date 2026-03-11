/**
 * Large file upload endpoint for Buildertrend migration.
 * Accepts a raw binary body (streamed) and uploads directly to Vercel Blob.
 * Returns the blob URL for use with /api/import-file (blobUrl field).
 */
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

const IMPORT_TOKEN = "bt-import-2026-williamson";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "https://buildertrend.net",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Import-Token, X-File-Name, X-Job-Name",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-import-token");
  if (token !== IMPORT_TOKEN) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const name = req.headers.get("x-file-name") || "file.pdf";
  const jobName = req.headers.get("x-job-name") || "unknown";
  const contentType = req.headers.get("content-type") || "application/pdf";

  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blobPath = `williamson/${jobName.replace(/[^a-zA-Z0-9]/g, "-")}/${Date.now()}_${safeName}`;

  const blob = await put(blobPath, req.body!, {
    access: "public",
    contentType,
  });

  return NextResponse.json(
    { ok: true, url: blob.url },
    { status: 201, headers: corsHeaders() }
  );
}
