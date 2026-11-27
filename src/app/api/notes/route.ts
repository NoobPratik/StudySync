import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { extractTextFromBuffer } from "@/lib/document-parser";

const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR || "./uploads",
);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get("subjectId");
  const search = searchParams.get("q")?.trim();

  const notes = await prisma.note.findMany({
    where: {
      userId: user.id,
      ...(subjectId && subjectId !== "ALL"
        ? subjectId === "UNASSIGNED"
          ? { subjectId: null }
          : { subjectId }
        : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { fileName: { contains: search } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      userId: true,
      subjectId: true,
      title: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      filePath: true,
      uploadedAt: true,
      subject: {
        select: { id: true, name: true, code: true, color: true },
      },
    },
    orderBy: { title: "asc" },
  });

  // Natural alphabetical sorting (Module 1, Module 2, ..., Module 10)
  notes.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  return NextResponse.json({ notes });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const titleInput = formData.get("title");
    const subjectIdInput = formData.get("subjectId");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 50 MB limit" },
        { status: 400 },
      );
    }

    const subjectId =
      typeof subjectIdInput === "string" &&
      subjectIdInput !== "" &&
      subjectIdInput !== "NONE"
        ? subjectIdInput
        : null;

    if (subjectId) {
      const subject = await prisma.subject.findFirst({
        where: { id: subjectId, userId: user.id },
      });
      if (!subject) {
        return NextResponse.json(
          { error: "Subject not found" },
          { status: 404 },
        );
      }
    }

    const safeBaseName = path
      .basename(file.name)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFileName = `${crypto.randomUUID()}-${safeBaseName}`;
    const userDir = path.join(UPLOAD_ROOT, user.id);
    await fs.mkdir(userDir, { recursive: true });

    const destPath = path.join(userDir, uniqueFileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(destPath, buffer);

    const fileType =
      file.type ||
      path.extname(file.name).slice(1) ||
      "application/octet-stream";

    const extractedText = await extractTextFromBuffer(
      buffer,
      file.name,
      fileType,
    );

    const title =
      typeof titleInput === "string" && titleInput.trim()
        ? titleInput.trim()
        : file.name.replace(/\.[^/.]+$/, "");

    const relativePath = path.relative(UPLOAD_ROOT, destPath);

    const note = await prisma.note.create({
      data: {
        userId: user.id,
        subjectId,
        title,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        filePath: relativePath,
        extractedText,
      },
      select: {
        id: true,
        userId: true,
        subjectId: true,
        title: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        filePath: true,
        uploadedAt: true,
        subject: {
          select: { id: true, name: true, code: true, color: true },
        },
      },
    });

    return NextResponse.json(
      { note, hasExtractedText: Boolean(extractedText) },
      { status: 201 },
    );
  } catch (err) {
    console.error("Note upload error:", err);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
}
