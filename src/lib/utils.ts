import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getErrorMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error && typeof error.message === "string"
          ? error.message
          : "";

  if (!message) return fallback;

  try {
    const payload: unknown = JSON.parse(message);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return message;

    const details: string[] = [];
    if ("issues" in payload && Array.isArray(payload.issues)) {
      for (const issue of payload.issues) {
        if (issue && typeof issue === "object" && "message" in issue && typeof issue.message === "string") {
          details.push(issue.message);
        }
      }
    }
    if ("formErrors" in payload && Array.isArray(payload.formErrors)) {
      details.push(...payload.formErrors.filter((item): item is string => typeof item === "string"));
    }
    if ("fieldErrors" in payload && payload.fieldErrors && typeof payload.fieldErrors === "object") {
      for (const [field, errors] of Object.entries(payload.fieldErrors)) {
        if (Array.isArray(errors)) {
          for (const item of errors) {
            if (typeof item === "string") details.push(`${field}: ${item}`);
          }
        }
      }
    }
    if (details.length) return details.join(". ");
    if ("message" in payload && typeof payload.message === "string") return payload.message;
    if ("error" in payload && typeof payload.error === "string") return payload.error;
    return fallback;
  } catch {
    return message;
  }
}

export const CANNED_OVERRIDE_PATTERNS = [
  /this override is required to unblock/i,
  /any technical debt and operational risks will be scheduled/i,
  /state detailed architectural justification/i,
  /state reason here/i,
  /\[.*?(?:reason|state|todo|placeholder).*?\]/i,
  /^(?:approved by admin|administrative override|override approved|lgtm|looks good to me|approved per discussion)[\.\!\s]*$/i,
];

export function validateOverrideRationale(comment: string): { valid: boolean; error?: string } {
  const trimmed = comment.trim();
  if (trimmed.length < 60) {
    return {
      valid: false,
      error: "A detailed rationale comment (at least 2 sentences / 60 characters) is mandatory when overriding review criteria or existing rejections.",
    };
  }

  // Check for canned patterns or unedited placeholders
  for (const pattern of CANNED_OVERRIDE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        error: "Generic canned text or unedited placeholders are not permitted. Please explain your architectural justification in your own words.",
      };
    }
  }

  // Check sentence structure: must have at least 2 sentences (separated by . ! or ?)
  const sentences = trimmed
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);

  if (sentences.length < 2) {
    return {
      valid: false,
      error: "Override rationale must contain at least 2 complete sentences (e.g., explaining the business necessity and the technical risk mitigation plan).",
    };
  }

  // Check unique word diversity (prevents repeating the same word)
  const words = trimmed.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const uniqueWords = new Set(words);
  if (uniqueWords.size < 10) {
    return {
      valid: false,
      error: "Override rationale must be substantive (at least 10 unique words required). Avoid repeating words.",
    };
  }

  return { valid: true };
}

export function normalizeAdrText(val: unknown): string {
  if (val == null) return "";
  return String(val).replace(/\r\n/g, "\n").trim();
}

export function normalizeAdrTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (t == null ? "" : String(t).trim()))
    .filter(Boolean)
    .sort();
}

export function normalizeAdrRecordStrings(obj: unknown): Record<string, string> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const result: Record<string, string> = {};
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of sortedKeys) {
    const val = (obj as Record<string, unknown>)[key];
    const cleaned = typeof val === "string" ? val.replace(/\r\n/g, "\n").trim() : "";
    if (cleaned) {
      result[key] = cleaned;
    }
  }
  return result;
}

export function normalizeAdrReferences(refs: unknown): Record<string, string[]> {
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return {};
  const result: Record<string, string[]> = {};
  const sortedKeys = Object.keys(refs as Record<string, unknown>).sort();
  for (const key of sortedKeys) {
    const val = (refs as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      const cleaned = val
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .sort();
      if (cleaned.length > 0) {
        result[key] = cleaned;
      }
    }
  }
  return result;
}

export function detectChangedAdrFields(
  incoming: {
    title?: string;
    context?: string;
    decision?: string;
    consequences?: string;
    alternatives?: string;
    tags?: string[];
    design_changes?: any;
    major_impacts?: any;
    references_data?: any;
  },
  existing: {
    title?: string;
    context?: string;
    decision?: string;
    consequences?: string;
    alternatives?: string;
    tags?: string[];
    design_changes?: any;
    major_impacts?: any;
    references_data?: any;
  }
): string[] {
  const changed: string[] = [];

  if (incoming.title !== undefined && normalizeAdrText(incoming.title) !== normalizeAdrText(existing.title)) {
    changed.push("Title");
  }
  if (incoming.context !== undefined && normalizeAdrText(incoming.context) !== normalizeAdrText(existing.context)) {
    changed.push("Context");
  }
  if (incoming.decision !== undefined && normalizeAdrText(incoming.decision) !== normalizeAdrText(existing.decision)) {
    changed.push("Decision");
  }
  if (incoming.consequences !== undefined && normalizeAdrText(incoming.consequences) !== normalizeAdrText(existing.consequences)) {
    changed.push("Consequences");
  }
  if (incoming.alternatives !== undefined && normalizeAdrText(incoming.alternatives) !== normalizeAdrText(existing.alternatives)) {
    changed.push("Alternatives");
  }
  if (incoming.tags !== undefined) {
    const incTags = JSON.stringify(normalizeAdrTags(incoming.tags));
    const exTags = JSON.stringify(normalizeAdrTags(existing.tags));
    if (incTags !== exTags) {
      changed.push("Tags");
    }
  }
  if (incoming.design_changes !== undefined) {
    const incDC = JSON.stringify(normalizeAdrRecordStrings(incoming.design_changes));
    const exDC = JSON.stringify(normalizeAdrRecordStrings(existing.design_changes));
    if (incDC !== exDC) {
      changed.push("Design Changes");
    }
  }
  if (incoming.major_impacts !== undefined) {
    const incMI = JSON.stringify(normalizeAdrRecordStrings(incoming.major_impacts));
    const exMI = JSON.stringify(normalizeAdrRecordStrings(existing.major_impacts));
    if (incMI !== exMI) {
      changed.push("Major Impacts");
    }
  }
  if (incoming.references_data !== undefined) {
    const incRef = JSON.stringify(normalizeAdrReferences(incoming.references_data));
    const exRef = JSON.stringify(normalizeAdrReferences(existing.references_data));
    if (incRef !== exRef) {
      changed.push("References");
    }
  }

  return changed;
}

