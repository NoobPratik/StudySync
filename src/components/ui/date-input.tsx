"use client";

import { useRef, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateInputProps {
  id?: string;
  value: string; // ISO YYYY-MM-DD or ""
  onChange: (isoDate: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

function isoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function displayToIso(disp: string): string | null {
  const clean = disp.trim();
  if (!clean) return "";
  const m = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const test = new Date(yyyy, mm - 1, dd);
  if (
    test.getFullYear() !== yyyy ||
    test.getMonth() !== mm - 1 ||
    test.getDate() !== dd
  ) {
    return null;
  }
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function DateInputDDMMYYYY({
  id,
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  required,
  className,
}: DateInputProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft !== null ? draft : isoToDisplay(value);

  function handleTextChange(raw: string) {
    // Auto-insert slashes cleanly when typing digits
    const digitsAndSlashes = raw.replace(/[^\d/]/g, "").slice(0, 10);
    let formatted = digitsAndSlashes;
    if (/^\d{3}$/.test(digitsAndSlashes)) {
      formatted = `${digitsAndSlashes.slice(0, 2)}/${digitsAndSlashes.slice(2)}`;
    } else if (/^\d{2}\/\d{3}$/.test(digitsAndSlashes)) {
      formatted = `${digitsAndSlashes.slice(0, 5)}/${digitsAndSlashes.slice(5)}`;
    }
    setDraft(formatted);

    if (!formatted.trim()) {
      onChange("");
      return;
    }
    const parsedIso = displayToIso(formatted);
    if (parsedIso) {
      onChange(parsedIso);
    }
  }

  function openNativePicker() {
    const el = pickerRef.current as
      | (HTMLInputElement & { showPicker?: () => void })
      | null;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {}
    }
    el.click();
  }

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={displayValue}
        placeholder={placeholder}
        required={required}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={() => setDraft(null)}
        className="flex h-10 w-full rounded-lg border border-glass-border bg-input/70 px-3 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-all"
      />
      <button
        type="button"
        onClick={openNativePicker}
        className="absolute right-2.5 p-1 rounded text-muted-foreground hover:text-primary cursor-pointer"
        title="Open calendar picker"
        tabIndex={-1}
      >
        <CalendarIcon className="h-4 w-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value}
        onChange={(e) => {
          setDraft(null);
          onChange(e.target.value);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
