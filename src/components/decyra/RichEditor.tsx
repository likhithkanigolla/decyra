import { useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
  required?: boolean;
}

export function RichEditor({ label, value, onChange, placeholder, hint, rows = 6, required }: Props) {
  return (
    <div data-color-mode="auto">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium text-muted-foreground">
          {label}{required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      </div>
      
      <div className="rounded-md border border-input focus-within:ring-2 focus-within:ring-ring overflow-hidden">
        <MDEditor
          value={value}
          onChange={(val) => onChange(val || "")}
          previewOptions={{
            rehypePlugins: [[rehypeSanitize]],
          }}
          height={rows * 30 + 60}
          preview="live"
          textareaProps={{
            placeholder: placeholder
          }}
          style={{ border: 'none', boxShadow: 'none' }}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div data-color-mode="auto">
      <MDEditor.Markdown 
        source={text} 
        style={{ backgroundColor: 'transparent' }} 
        rehypePlugins={[[rehypeSanitize]]} 
      />
    </div>
  );
}
