import { useState } from "react";
import { Eye, Edit3 } from "lucide-react";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
  required?: boolean;
}

/**
 * Markdown textarea with a live preview toggle.
 * Pure textarea — no heavy editor dependency. Preview renders basic markdown.
 */
export function RichEditor({ label, value, onChange, placeholder, hint, rows = 6, required }: Props) {
  const [preview, setPreview] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-muted-foreground">
          {label}{required && <span className="text-destructive ml-0.5">*</span>}
        </label>
        <button
          type="button"
          onClick={() => setPreview(!preview)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-accent"
        >
          {preview ? <Edit3 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div
          className="min-h-[120px] rounded-md border border-input bg-background px-4 py-3 text-sm prose-sm prose dark:prose-invert max-w-none leading-relaxed whitespace-pre-wrap"
          style={{ fontFamily: "inherit" }}
        >
          {value ? (
            <SimpleMarkdown text={value} />
          ) : (
            <span className="text-muted-foreground italic">Nothing to preview.</span>
          )}
        </div>
      ) : (
        <textarea
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm font-mono leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

/** Very lightweight Markdown → React renderer (no deps) */
export function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^### /.test(line)) {
      elements.push(<h3 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(4)}</h3>);
    } else if (/^## /.test(line)) {
      elements.push(<h2 key={i} className="text-lg font-semibold mt-4 mb-1">{line.slice(3)}</h2>);
    } else if (/^# /.test(line)) {
      elements.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2">{line.slice(2)}</h1>);
    } else if (/^- /.test(line) || /^\* /.test(line)) {
      elements.push(<li key={i} className="ml-4 list-disc text-sm">{inlineFormat(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      elements.push(<li key={i} className="ml-4 list-decimal text-sm">{inlineFormat(line.replace(/^\d+\. /, ""))}</li>);
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={i} className="border-l-2 border-primary pl-3 text-muted-foreground italic text-sm my-1">
          {inlineFormat(line.slice(2))}
        </blockquote>
      );
    } else if (line === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed">{inlineFormat(line)}</p>);
    }
    i++;
  }
  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  // Bold **text** and inline code `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="rounded bg-muted px-1 font-mono text-[0.8em]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
