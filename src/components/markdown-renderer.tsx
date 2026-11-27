"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

export function MarkdownRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose-study text-sm leading-relaxed text-foreground space-y-2.5 break-words",
        "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-foreground [&_h1]:mt-3 [&_h1]:mb-1.5",
        "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-accent [&_h2]:mt-3 [&_h2]:mb-1",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-2.5 [&_h3]:mb-1",
        "[&_p]:my-1.5",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:my-1.5",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:my-1.5",
        "[&_li]:text-foreground/95",
        "[&_strong]:font-semibold [&_strong]:text-white",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-2",
        "[&_code]:rounded [&_code]:bg-background/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-accent",
        "[&_pre]:rounded-xl [&_pre]:border [&_pre]:border-glass-border [&_pre]:bg-[#080814] [&_pre]:p-3.5 [&_pre]:overflow-x-auto [&_pre]:my-2.5",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs [&_pre_code]:text-foreground",
        "[&_table]:w-full [&_table]:border-collapse [&_table]:my-2.5 [&_table]:text-xs",
        "[&_th]:border [&_th]:border-glass-border [&_th]:bg-primary/15 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
        "[&_td]:border [&_td]:border-glass-border [&_td]:px-2.5 [&_td]:py-1.5",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary",
        "[&_hr]:border-glass-border [&_hr]:my-3",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
