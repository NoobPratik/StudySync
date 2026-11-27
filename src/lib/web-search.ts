import "server-only";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchWebTool(
  query: string,
  limit = 5,
): Promise<WebSearchResult[]> {
  const cleanQuery = query.trim().slice(0, 200);
  if (!cleanQuery) return [];

  const results: WebSearchResult[] = [];

  // 1. DuckDuckGo HTML search
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (res.ok) {
      const html = await res.text();
      const blocks = html.split(/class="result__body"/g).slice(1, limit + 3);
      for (const block of blocks) {
        const titleMatch = block.match(
          /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
        );
        const snippetMatch = block.match(
          /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
        );

        if (titleMatch) {
          let href = titleMatch[1];
          const uddg = href.match(/uddg=([^&]+)/);
          if (uddg) {
            href = decodeURIComponent(uddg[1]);
          }
          const title = stripHtml(titleMatch[2]);
          const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
          if (title && !href.includes("duckduckgo.com/y.js")) {
            results.push({ title, url: href, snippet });
          }
        }
        if (results.length >= limit) break;
      }
    }
  } catch {
    // Fall through to Wikipedia fallback
  }

  // 2. Wikipedia OpenSearch / Query fallback for academic concepts
  if (results.length < 2) {
    try {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&format=json&srlimit=${limit}`,
        {
          headers: {
            "User-Agent": "StudySync/1.0 (https://localhost:3000)",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (wikiRes.ok) {
        const json = (await wikiRes.json()) as {
          query?: {
            search?: Array<{ title: string; snippet: string; pageid: number }>;
          };
        };
        for (const item of json.query?.search || []) {
          results.push({
            title: `${item.title} — Wikipedia`,
            url: `https://en.wikipedia.org/?curid=${item.pageid}`,
            snippet: stripHtml(item.snippet),
          });
          if (results.length >= limit) break;
        }
      }
    } catch {
      // Ignore fallback errors
    }
  }

  return results.slice(0, limit);
}

export function formatSearchResultsForPrompt(
  results: WebSearchResult[],
): string {
  if (results.length === 0) return "";
  return results
    .map(
      (r, idx) =>
        `[${idx + 1}] ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}`,
    )
    .join("\n\n");
}
