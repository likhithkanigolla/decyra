import { describe, it, expect } from "vitest";
import {
  cn,
  getErrorMessage,
  validateOverrideRationale,
  detectChangedAdrFields,
  normalizeAdrText,
  normalizeAdrTags,
  normalizeAdrRecordStrings,
  normalizeAdrReferences,
} from "@/lib/utils";

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

  describe("validateOverrideRationale", () => {
    it("rejects empty or whitespace rationale", () => {
      const res = validateOverrideRationale("   ");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("at least 2 sentences / 60 characters");
    });

    it("rejects comments with fewer than 60 characters", () => {
      const res = validateOverrideRationale("Short reason. Another sentence.");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("at least 2 sentences / 60 characters");
    });

    it("rejects canned boilerplate sentences", () => {
      const canned =
        "This override is required to unblock upcoming delivery milestones. Any technical debt and operational risks will be scheduled for remediation in the next release cycle.";
      const res = validateOverrideRationale(canned);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Generic canned text or unedited placeholders are not permitted");
    });

    it("rejects unedited placeholder brackets", () => {
      const res = validateOverrideRationale(
        "We need this approved right away. [State detailed architectural justification here for the team]."
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Generic canned text or unedited placeholders are not permitted");
    });

    it("rejects single long sentences lacking sentence breaks", () => {
      const singleSentence =
        "This is an override rationale that has sufficient characters to pass sixty character count but only contains one long run-on sentence without any period";
      const res = validateOverrideRationale(singleSentence);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("must contain at least 2 complete sentences");
    });

    it("rejects repetitive word stuffing with low vocabulary diversity", () => {
      const spam =
        "Override override override override. Override override override override override override override.";
      const res = validateOverrideRationale(spam);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("at least 10 unique words required");
    });

    it("accepts genuine, multi-sentence architectural justification", () => {
      const valid =
        "We are adopting PostgreSQL JSONB instead of DynamoDB for this service. Team concerns regarding migration complexity are mitigated by writing automated Liquibase migrations.";
      const res = validateOverrideRationale(valid);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });
  });

  describe("detectChangedAdrFields", () => {
    it("returns empty array when form submits default empty objects against null or empty DB records", () => {
      const incoming = {
        title: "Same Title",
        context: "Same Context\r\n",
        decision: "Same Decision",
        consequences: "Same Consequences",
        alternatives: "",
        tags: [],
        design_changes: {
          api_changes: "",
          workflow_changes: "",
          service_changes: "",
          infrastructure_changes: "",
          data_model_changes: "",
        },
        major_impacts: {
          operational: "",
          testing: "",
          security: "",
          documentation: "",
          scalability: "",
        },
        references_data: {
          pull_requests: [],
          git_commits: [],
          design_docs: [],
          wiki_pages: [],
          external: [],
        },
      };

      const existing = {
        title: "Same Title",
        context: "Same Context\n",
        decision: "Same Decision",
        consequences: "Same Consequences",
        alternatives: null as any,
        tags: null as any,
        design_changes: null as any,
        major_impacts: {},
        references_data: null as any,
      };

      const changed = detectChangedAdrFields(incoming, existing);
      expect(changed).toEqual([]);
    });

    it("detects only the specific field that was actually modified", () => {
      const incoming = {
        title: "Brand New Title",
        context: "Same Context",
        decision: "Same Decision",
        consequences: "Same Consequences",
        alternatives: "",
        tags: ["architecture"],
        design_changes: {
          api_changes: "",
          workflow_changes: "",
          service_changes: "",
          infrastructure_changes: "",
          data_model_changes: "",
        },
        major_impacts: {
          operational: "",
          testing: "",
          security: "",
          documentation: "",
          scalability: "",
        },
        references_data: {
          pull_requests: [],
          git_commits: [],
          design_docs: [],
          wiki_pages: [],
          external: [],
        },
      };

      const existing = {
        title: "Old Title",
        context: "Same Context",
        decision: "Same Decision",
        consequences: "Same Consequences",
        alternatives: null as any,
        tags: ["architecture"],
        design_changes: {},
        major_impacts: {},
        references_data: {},
      };

      const changed = detectChangedAdrFields(incoming, existing);
      expect(changed).toEqual(["Title"]);
    });

    it("detects when design changes, major impacts, or references are genuinely modified", () => {
      const incoming = {
        design_changes: {
          api_changes: "Added /api/v2 endpoint",
          workflow_changes: "",
        },
        major_impacts: {
          operational: "Requires Redis sentinel cluster",
        },
        references_data: {
          pull_requests: ["#101"],
        },
      };

      const existing = {
        design_changes: {},
        major_impacts: null,
        references_data: { pull_requests: [] },
      };

      const changed = detectChangedAdrFields(incoming, existing);
      expect(changed).toEqual(["Design Changes", "Major Impacts", "References"]);
    });

    it("ignores whitespace differences and tag ordering differences", () => {
      const incoming = {
        title: "  Architecture Overview  ",
        tags: ["beta", "alpha"],
      };

      const existing = {
        title: "Architecture Overview",
        tags: ["alpha", "beta"],
      };

      const changed = detectChangedAdrFields(incoming, existing);
      expect(changed).toEqual([]);
    });
  });
});
