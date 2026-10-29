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
