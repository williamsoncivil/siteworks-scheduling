import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { PREDEFINED_CATEGORIES } from "@/lib/categories";

// Store custom categories in memory for now (in production, use a database)
let customCategories: string[] = [];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({
    predefined: PREDEFINED_CATEGORIES,
    custom: customCategories,
    all: [...PREDEFINED_CATEGORIES, ...customCategories],
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { name } = await req.json();
  const catName = name?.trim().toLowerCase();

  if (!catName) {
    return NextResponse.json({ error: "Category name required" }, { status: 400 });
  }

  if (PREDEFINED_CATEGORIES.includes(catName) || customCategories.includes(catName)) {
    return NextResponse.json({ error: "Category already exists" }, { status: 400 });
  }

  customCategories.push(catName);

  return NextResponse.json({ success: true, categories: customCategories });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name")?.toLowerCase();

  if (!name) {
    return NextResponse.json({ error: "Category name required" }, { status: 400 });
  }

  if (PREDEFINED_CATEGORIES.includes(name)) {
    return NextResponse.json({ error: "Cannot delete predefined category" }, { status: 400 });
  }

  customCategories = customCategories.filter((c) => c !== name);

  return NextResponse.json({ success: true, categories: customCategories });
}
