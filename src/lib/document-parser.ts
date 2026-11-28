import path from "path";
import JSZip from "jszip";
import { extractText } from "unpdf";

const MAX_EXTRACTED_CHARS = 150000;

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlTags(xml: string): string {
  return decodeXmlTags(xml.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlTags(str: string): string {
  return decodeXmlEntities(str);
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  const ext = path.extname(fileName).toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();

  try {
    // Plain text formats
    if (
      [".txt", ".md", ".csv", ".json", ".c", ".cpp", ".py", ".ts", ".js"].includes(
        ext,
      ) ||
      lowerMime.startsWith("text/")
    ) {
      return buffer.toString("utf-8").slice(0, MAX_EXTRACTED_CHARS).trim() || null;
    }

    // PDF — extract per-page to preserve exact chronological page boundaries
    if (ext === ".pdf" || lowerMime.includes("pdf")) {
      const { text: pages } = await extractText(new Uint8Array(buffer), {
        mergePages: false,
      });
      const formattedPages = pages
        .map((pageText, idx) => {
          const clean = pageText.replace(/\s+\n/g, "\n").trim();
          return clean ? `[Page ${idx + 1}]\n${clean}` : "";
        })
        .filter(Boolean);
      const cleaned = formattedPages.join("\n\n").trim();
      return cleaned ? cleaned.slice(0, MAX_EXTRACTED_CHARS) : null;
    }

    // PowerPoint (.pptx)
    if (ext === ".pptx" || lowerMime.includes("presentationml")) {
      const zip = await JSZip.loadAsync(buffer);
      const slideFiles = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const slides: string[] = [];
      for (let i = 0; i < slideFiles.length; i++) {
        const slidePath = slideFiles[i];
        const xml = await zip.files[slidePath].async("string");
        const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
        const slideText = matches
          .map((m) => stripXmlTags(m))
          .filter(Boolean)
          .join(" ");
        if (slideText) {
          slides.push(`[Slide ${i + 1}]\n${slideText}`);
        }
      }
      const joined = slides.join("\n\n").trim();
      return joined ? joined.slice(0, MAX_EXTRACTED_CHARS) : null;
    }

    // Word (.docx)
    if (ext === ".docx" || lowerMime.includes("wordprocessingml")) {
      const zip = await JSZip.loadAsync(buffer);
      const docFile = zip.files["word/document.xml"];
      if (!docFile) return null;
      const xml = await docFile.async("string");
      const paragraphs = xml.split(/<\/w:p>/g).map((p) => {
        const runs = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return runs.map((r) => stripXmlTags(r)).join("");
      });
      const joined = paragraphs.filter(Boolean).join("\n").trim();
      return joined ? joined.slice(0, MAX_EXTRACTED_CHARS) : null;
    }

    return null;
  } catch (err) {
    console.error("Text extraction failed for", fileName, err);
    return null;
  }
}
