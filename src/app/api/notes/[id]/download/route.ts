import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const note = await prisma.note.findFirst({
    where: { id, userId: user.id },
  });

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const fullPath = path.resolve(UPLOAD_ROOT, note.filePath);
  if (!fullPath.startsWith(UPLOAD_ROOT)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  try {
    const fileBuffer = await fs.readFile(fullPath);
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    const safeName = note.fileName.replace(/["\r\n]/g, "_");

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": note.fileType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "Content-Length": String(fileBuffer.length),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "File not found on disk" },
      { status: 404 },
    );
  }
}
