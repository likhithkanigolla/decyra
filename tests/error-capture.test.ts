import { describe, it, expect } from "vitest";
import { consumeLastCapturedError } from "@/lib/error-capture";

describe("error-capture", () => {
  it("returns undefined when no error has been captured", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("consumes and clears captured error", () => {
    // Dispatch an unhandled error event
    const testError = new Error("Sample test error");
    if (typeof globalThis.dispatchEvent === "function") {
      const errorEvent = new Event("error") as any;
      errorEvent.error = testError;
      globalThis.dispatchEvent(errorEvent);

      const captured = consumeLastCapturedError();
      expect(captured).toBe(testError);

      // Verify it is single-use (cleared after consuming)
      expect(consumeLastCapturedError()).toBeUndefined();
    }
  });
});
