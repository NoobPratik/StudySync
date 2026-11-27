"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  User,
  GraduationCap,
  Plus,
  Trash2,
  Save,
  Loader2,
  Building2,
  Camera,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface CustomField {
  label: string;
  value: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Universal academic fields
  const [institution, setInstitution] = useState("");
  const [program, setProgram] = useState("");
  const [branch, setBranch] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [semesterEndDate, setSemesterEndDate] = useState("");

  // Optional college-specific identifiers
  const [section, setSection] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [usn, setUsn] = useState("");

  // Dynamic universal custom fields
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setName(data.user?.name || "");
        setEmail(data.user?.email || "");
        setImage(data.user?.image || null);

        const p = data.profile || {};
        setInstitution(p.institution || "");
        setProgram(p.program || "");
        setBranch(p.branch || "");
        setYear(p.year || "");
        setSemester(p.semester || "");
        setSection(p.section || "");
        setRollNo(p.rollNo || "");
        setUsn(p.usn || "");
        setSemesterEndDate(
          p.semesterEndDate ? String(p.semesterEndDate).slice(0, 10) : "",
        );
        setCustomFields(Array.isArray(p.customFields) ? p.customFields : []);
      } catch {
        toast.error("Failed to load profile");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Full name is required");
      return;
    }

    const validCustom = customFields.filter((f) => f.label.trim() !== "");

    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          image,
          institution: institution || null,
          program: program || null,
          branch: branch || null,
          year: year || null,
          semester: semester || null,
          section: section || null,
          rollNo: rollNo || null,
          usn: usn || null,
          semesterEndDate: semesterEndDate || null,
          customFields: validCustom,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Student profile saved!");
      router.refresh();
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function compressAndSaveAvatar(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, WEBP)");
      return;
    }
    setUploadingAvatar(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.onload = () => {
          const img = new window.Image();
          img.onerror = () => reject(new Error("Invalid image"));
          img.onload = () => {
            const size = 256;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas unavailable"));
              return;
            }
            // Center-crop square avatar
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save avatar");
      }
      setImage(dataUrl);
      toast.success("Profile picture updated!");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile picture",
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    setUploadingAvatar(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: null }),
      });
      if (!res.ok) throw new Error();
      setImage(null);
      toast.success("Profile picture removed");
      router.refresh();
    } catch {
      toast.error("Failed to remove photo");
    } finally {
      setUploadingAvatar(false);
    }
  }

  function addCustomField() {
    setCustomFields((prev) => [...prev, { label: "", value: "" }]);
  }

  function updateCustomField(index: number, key: "label" | "value", val: string) {
    setCustomFields((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [key]: val } : item)),
    );
  }

  function removeCustomField(index: number) {
    setCustomFields((prev) => prev.filter((_, idx) => idx !== index));
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-12 w-64 rounded-lg shimmer" />
        <div className="h-96 rounded-xl shimmer" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold">
          Student <span className="gradient-text">Profile</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Universal academic profile — fill only what matters for your degree
          and university
        </p>
      </motion.div>

      {/* Profile Header Card */}
      <Card className="gradient-border">
        <CardContent className="pt-0 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="relative group shrink-0 w-fit">
            <Avatar className="h-20 w-20 border-2 border-primary/40 shadow-lg">
              <AvatarImage src={image || undefined} alt={name} />
              <AvatarFallback className="text-lg">
                {name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2) || "ST"}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute bottom-0 right-0 h-7 w-7 rounded-full bg-primary text-white border border-background flex items-center justify-center shadow hover:bg-primary/90 cursor-pointer transition-transform group-hover:scale-105"
              title="Change profile photo"
            >
              {uploadingAvatar ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) compressAndSaveAvatar(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-foreground">
                {name || "Student"}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  <Camera className="h-3 w-3" /> {image ? "Change Photo" : "Upload Photo"}
                </Button>
                {image && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    onClick={removeAvatar}
                    disabled={uploadingAvatar}
                  >
                    <X className="h-3 w-3" /> Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{email}</p>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {program && <Badge>{program}</Badge>}
              {branch && <Badge variant="secondary">{branch}</Badge>}
              {year && <Badge variant="outline">{year} Year</Badge>}
              {semester && <Badge variant="outline">Sem {semester}</Badge>}
              {institution && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> {institution}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core Academic Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4 text-primary" />
              Core Academic Details
            </CardTitle>
            <CardDescription>
              Universal details compatible with any college, university, or
              program.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prof-name">Full Name</Label>
              <Input
                id="prof-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prof-inst">Institution / University</Label>
              <Input
                id="prof-inst"
                placeholder="e.g., Dayananda Sagar University"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prof-program">Program / Degree</Label>
              <Input
                id="prof-program"
                placeholder="e.g., BTech, BSc, BCA, BA"
                value={program}
                onChange={(e) => setProgram(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prof-branch">Branch / Major / Stream</Label>
              <Input
                id="prof-branch"
                placeholder="e.g., CSE, Data Science, Economics"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prof-year">Academic Year</Label>
              <Input
                id="prof-year"
                placeholder="e.g., 1st, 2nd, 3rd"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prof-sem">Current Semester / Term</Label>
              <Input
                id="prof-sem"
                placeholder="e.g., 1st, Fall 2026"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="prof-end">
                Target Semester / Exam End Date (Used for Progress Pacing)
              </Label>
              <Input
                id="prof-end"
                type="date"
                value={semesterEndDate}
                onChange={(e) => setSemesterEndDate(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Optional College Identifiers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-accent" />
              Optional Institutional Identifiers
            </CardTitle>
            <CardDescription>
              Leave blank if your institution doesn&apos;t use these fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prof-section">Section / Batch</Label>
              <Input
                id="prof-section"
                placeholder="e.g., A4"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prof-roll">Roll Number</Label>
              <Input
                id="prof-roll"
                placeholder="e.g., 23"
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prof-usn">Student ID / USN</Label>
              <Input
                id="prof-usn"
                placeholder="e.g., ENG26CS0674"
                value={usn}
                onChange={(e) => setUsn(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Custom Universal Fields */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Custom Fields</CardTitle>
              <CardDescription>
                Add any extra details like Mentor Name, Target CGPA, Lab Batch,
                etc.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCustomField}
            >
              <Plus className="h-3.5 w-3.5" /> Add Field
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {customFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No custom fields added yet.
              </p>
            ) : (
              customFields.map((field, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Input
                    placeholder="Field name (e.g. Target GPA)"
                    value={field.label}
                    onChange={(e) =>
                      updateCustomField(index, "label", e.target.value)
                    }
                  />
                  <Input
                    placeholder="Value (e.g. 9.2)"
                    value={field.value}
                    onChange={(e) =>
                      updateCustomField(index, "value", e.target.value)
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => removeCustomField(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" variant="glow" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Profile
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
