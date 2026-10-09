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
