import { describe, it, expect } from "vitest";
import { cn, getErrorMessage } from "@/lib/utils";

describe("utils", () => {
  describe("cn", () => {
    it("merges class names correctly", () => {
      expect(cn("px-2 py-1", "bg-red-500")).toBe("px-2 py-1 bg-red-500");
    });

    it("handles conditional classes and falsy values", () => {
      expect(cn("base-class", false && "hidden", null, undefined, "extra")).toBe("base-class extra");
    });

    it("resolves tailwind merge conflicts appropriately", () => {
      expect(cn("p-4", "p-2")).toBe("p-2");
      expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    });
  });

  describe("getErrorMessage", () => {
    it("returns message from standard Error object", () => {
      const err = new Error("Something went wrong");
      expect(getErrorMessage(err, "Fallback")).toBe("Something went wrong");
    });

    it("returns string error as is", () => {
      expect(getErrorMessage("Direct error string", "Fallback")).toBe("Direct error string");
    });

    it("returns message property from object if present", () => {
      expect(getErrorMessage({ message: "Custom object error" }, "Fallback")).toBe("Custom object error");
    });

    it("returns fallback for null, undefined or empty string", () => {
      expect(getErrorMessage(null, "Fallback")).toBe("Fallback");
      expect(getErrorMessage(undefined, "Fallback")).toBe("Fallback");
      expect(getErrorMessage("", "Fallback")).toBe("Fallback");
      expect(getErrorMessage(new Error(""), "Fallback")).toBe("Fallback");
    });

    it("extracts details from parsed JSON with issues", () => {
      const jsonError = JSON.stringify({
        issues: [{ message: "Field 1 required" }, { message: "Invalid email" }],
      });
      expect(getErrorMessage(new Error(jsonError), "Fallback")).toBe(
        "Field 1 required. Invalid email"
      );
    });

    it("extracts details from parsed JSON with formErrors and fieldErrors", () => {
      const jsonError = JSON.stringify({
        formErrors: ["Form is invalid"],
        fieldErrors: {
          username: ["Username is too short"],
          email: ["Email format invalid"],
        },
      });
      const result = getErrorMessage(new Error(jsonError), "Fallback");
      expect(result).toContain("Form is invalid");
      expect(result).toContain("username: Username is too short");
      expect(result).toContain("email: Email format invalid");
    });

    it("extracts single error or message property from JSON error string", () => {
      const jsonErrorMsg = JSON.stringify({ message: "Server connection failed" });
      expect(getErrorMessage(new Error(jsonErrorMsg), "Fallback")).toBe("Server connection failed");

      const jsonErrorErr = JSON.stringify({ error: "Unauthorized access" });
      expect(getErrorMessage(new Error(jsonErrorErr), "Fallback")).toBe("Unauthorized access");
    });
  });
});
