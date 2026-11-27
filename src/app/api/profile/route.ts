import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApiUser } from "@/lib/session";

const customFieldSchema = z.object({
  label: z.string().min(1).max(60),
  value: z.string().max(120),
});

const updateProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(120).optional(),
  image: z
    .string()
    .max(450000, "Image too large (keep under 300KB)")
    .refine(
      (val) =>
        val.startsWith("data:image/") ||
        val.startsWith("https://") ||
        val.startsWith("http://"),
      "Must be an uploaded image or http(s) URL",
    )
    .optional()
    .nullable(),
  institution: z.string().max(160).optional().nullable(),
  program: z.string().max(80).optional().nullable(),
  branch: z.string().max(100).optional().nullable(),
  year: z.string().max(40).optional().nullable(),
  semester: z.string().max(40).optional().nullable(),
  section: z.string().max(40).optional().nullable(),
  rollNo: z.string().max(40).optional().nullable(),
  usn: z.string().max(60).optional().nullable(),
  semesterEndDate: z.string().optional().nullable(),
  customFields: z.array(customFieldSchema).max(15).optional(),
});

export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      createdAt: true,
      profile: true,
    },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let customFields: Array<{ label: string; value: string }> = [];
  if (dbUser.profile?.customFields) {
    try {
      customFields = JSON.parse(dbUser.profile.customFields);
    } catch {
      customFields = [];
    }
  }

  return NextResponse.json({
    user: {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      image: dbUser.image,
      createdAt: dbUser.createdAt,
    },
    profile: dbUser.profile
      ? {
          ...dbUser.profile,
          customFields,
        }
      : {
          institution: "",
          program: "",
          branch: "",
          year: "",
          semester: "",
          section: "",
          rollNo: "",
          usn: "",
          semesterEndDate: null,
          customFields: [],
        },
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid profile data" },
        { status: 400 },
      );
    }

    const d = parsed.data;

    if (d.name !== undefined || d.image !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(d.name !== undefined ? { name: d.name.trim() } : {}),
          ...(d.image !== undefined ? { image: d.image } : {}),
        },
      });
    }

    const semesterEndDate =
      d.semesterEndDate && d.semesterEndDate !== ""
        ? new Date(d.semesterEndDate)
        : null;

    const profileData = {
      institution: d.institution?.trim() || null,
      program: d.program?.trim() || null,
      branch: d.branch?.trim() || null,
      year: d.year?.trim() || null,
      semester: d.semester?.trim() || null,
      section: d.section?.trim() || null,
      rollNo: d.rollNo?.trim() || null,
      usn: d.usn?.trim() || null,
      semesterEndDate:
        semesterEndDate && !isNaN(semesterEndDate.getTime())
          ? semesterEndDate
          : null,
      customFields: d.customFields ? JSON.stringify(d.customFields) : null,
    };

    const profile = await prisma.profile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...profileData,
      },
      update: profileData,
    });

    let customFields: Array<{ label: string; value: string }> = [];
    if (profile.customFields) {
      try {
        customFields = JSON.parse(profile.customFields);
      } catch {
        customFields = [];
      }
    }

    return NextResponse.json({
      profile: {
        ...profile,
        customFields,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 },
    );
  }
}
