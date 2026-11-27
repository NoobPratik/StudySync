import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";
import { extractTextFromBuffer } from "@/lib/document-parser";

export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subjectId = new URL(request.url).searchParams.get("subjectId");

  const samplePapers = await prisma.samplePaper.findMany({
    where: {
      userId: user.id,
      ...(subjectId && subjectId !== "ALL" ? { subjectId } : {}),
    },
    select: {
      id: true,
      subjectId: true,
      title: true,
      fileName: true,
      createdAt: true,
      subject: { select: { id: true, name: true, code: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ samplePapers });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let title = "";
    let fileName = "pasted-sample-paper.txt";
    let subjectId: string | null = null;
    let extractedText = "";

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await request.formData();
      const file = fd.get("file");
      title = String(fd.get("title") || "").trim();
      const sub = String(fd.get("subjectId") || "");
      subjectId = sub && sub !== "NONE" ? sub : null;
      const pasted = String(fd.get("text") || "").trim();

      if (file instanceof File && file.size > 0) {
        fileName = file.name;
        const buf = Buffer.from(await file.arrayBuffer());
        extractedText =
          (await extractTextFromBuffer(buf, file.name, file.type)) || "";
        if (!title) title = file.name.replace(/\.[^/.]+$/, "");
      } else if (pasted) {
        extractedText = pasted;
      }
    } else {
      const body = await request.json();
      title = String(body.title || "").trim();
      subjectId =
        typeof body.subjectId === "string" && body.subjectId !== "NONE"
          ? body.subjectId
          : null;
      extractedText = String(body.text || "").trim();
    }

    if (!extractedText.trim()) {
      return NextResponse.json(
        {
          error:
            "Could not extract readable text from the sample paper. Upload a text-based PDF/DOCX/TXT or paste the question paper text.",
        },
        { status: 400 },
      );
    }

    const paper = await prisma.samplePaper.create({
      data: {
        userId: user.id,
        subjectId,
        title: title || "Previous Year Question Paper",
        fileName,
        extractedText: extractedText.slice(0, 15000),
      },
      select: {
        id: true,
        subjectId: true,
        title: true,
        fileName: true,
        createdAt: true,
        subject: { select: { id: true, name: true, code: true, color: true } },
      },
    });

    return NextResponse.json({ samplePaper: paper }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to save sample paper" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await prisma.samplePaper.deleteMany({
    where: { id, userId: user.id },
  });

  return NextResponse.json({ success: true });
}
