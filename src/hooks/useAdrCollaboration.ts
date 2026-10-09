import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as Y from "yjs";
import {
  appendAdrCollaborationUpdate,
  getAdrCollaborationUpdates,
  joinAdrCollaboration,
} from "@/lib/api/decyra.functions";
import { DEFAULT_ADR_FORM, type AdrFormData } from "@/components/decyra/AdrForm";
import { toast } from "sonner";

const REMOTE_ORIGIN = "remote";
const TEXT_FIELDS = [
  "title",
  "tags",
  "context",
  "decision",
  "consequences",
  "alternatives",
] as const;
const REFERENCE_FIELDS = [
  "pull_requests",
  "git_commits",
  "design_docs",
  "wiki_pages",
  "external",
] as const;
const DESIGN_FIELDS = [
  "api_changes",
  "workflow_changes",
  "service_changes",
  "infrastructure_changes",
  "data_model_changes",
] as const;
const IMPACT_FIELDS = ["operational", "testing", "security", "documentation", "scalability"] as const;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export interface AdrCollaborationState {
  form: AdrFormData;
  status: string;
  relationships: unknown[];
  relationshipsRevision?: string;
}

interface Options {
  onRemoteChange?: (state: AdrCollaborationState) => void;
  syncLocalForm?: boolean;
}

function encodeState(state: AdrCollaborationState): string {
  const doc = new Y.Doc();
  for (const field of TEXT_FIELDS) {
    doc.getText(`form:${field}`).insert(0, state.form[field]);
  }
  for (const field of DESIGN_FIELDS) {
    doc.getText(`design:${field}`).insert(0, state.form.design_changes[field]);
  }
  for (const field of IMPACT_FIELDS) {
    doc.getText(`impact:${field}`).insert(0, state.form.major_impacts[field]);
  }
  for (const field of REFERENCE_FIELDS) {
    const values = state.form.references_data[field];
    if (values.length) doc.getArray<string>(`references:${field}`).push(values);
  }
  const metadata = doc.getMap<string>("metadata");
  metadata.set("status", state.status);
  metadata.set("relationships", JSON.stringify(state.relationships));
  const snapshot = encodeBase64(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return snapshot;
}

function readState(doc: Y.Doc): AdrCollaborationState {
  const form: AdrFormData = {
    ...DEFAULT_ADR_FORM,
    title: doc.getText("form:title").toString(),
    tags: doc.getText("form:tags").toString(),
    context: doc.getText("form:context").toString(),
    decision: doc.getText("form:decision").toString(),
    consequences: doc.getText("form:consequences").toString(),
    alternatives: doc.getText("form:alternatives").toString(),
    design_changes: Object.fromEntries(
      DESIGN_FIELDS.map((field) => [field, doc.getText(`design:${field}`).toString()])
    ) as AdrFormData["design_changes"],
    major_impacts: Object.fromEntries(
      IMPACT_FIELDS.map((field) => [field, doc.getText(`impact:${field}`).toString()])
    ) as AdrFormData["major_impacts"],
    references_data: Object.fromEntries(
      REFERENCE_FIELDS.map((field) => [
        field,
        doc.getArray<string>(`references:${field}`).toArray(),
      ])
    ) as AdrFormData["references_data"],
  };
  const metadata = doc.getMap<string>("metadata");
  let relationships: unknown[] = [];
  try {
    relationships = JSON.parse(metadata.get("relationships") ?? "[]") as unknown[];
  } catch {
    throw new Error("The shared ADR relationship data is invalid.");
  }
  return {
    form,
    status: metadata.get("status") ?? "draft",
    relationships,
    relationshipsRevision: metadata.get("relationshipsRevision"),
  };
}

function replaceText(text: Y.Text, value: string) {
  const current = text.toString();
  if (current === value) return;

  let prefix = 0;
  while (prefix < current.length && prefix < value.length && current[prefix] === value[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < value.length - prefix &&
    current[current.length - suffix - 1] === value[value.length - suffix - 1]
  ) {
    suffix++;
  }

  const deleteLength = current.length - prefix - suffix;
  const insertValue = value.slice(prefix, value.length - suffix);
  if (deleteLength) text.delete(prefix, deleteLength);
  if (insertValue) text.insert(prefix, insertValue);
}

function syncForm(doc: Y.Doc, form: AdrFormData) {
  doc.transact(() => {
    for (const field of TEXT_FIELDS) replaceText(doc.getText(`form:${field}`), form[field]);
    for (const field of DESIGN_FIELDS) {
      replaceText(doc.getText(`design:${field}`), form.design_changes[field]);
    }
    for (const field of IMPACT_FIELDS) {
      replaceText(doc.getText(`impact:${field}`), form.major_impacts[field]);
    }
    for (const field of REFERENCE_FIELDS) {
      const array = doc.getArray<string>(`references:${field}`);
      const next = form.references_data[field];
      const current = array.toArray();
      if (current.length === next.length && current.every((value, index) => value === next[index])) {
        continue;
      }
      if (current.length) array.delete(0, current.length);
      if (next.length) array.insert(0, next);
    }
  });
}

export function useAdrCollaboration(
  adrId: string,
  initialState: AdrCollaborationState | undefined,
  options: Options = {}
) {
  const [ready, setReady] = useState(false);
  const joinFn = useServerFn(joinAdrCollaboration);
  const pollFn = useServerFn(getAdrCollaborationUpdates);
  const appendFn = useServerFn(appendAdrCollaborationUpdate);
  const docRef = useRef<Y.Doc | null>(null);
  const onRemoteChangeRef = useRef(options.onRemoteChange);
  onRemoteChangeRef.current = options.onRemoteChange;
  const syncLocalFormRef = useRef(options.syncLocalForm ?? true);
  syncLocalFormRef.current = options.syncLocalForm ?? true;
  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;
  const lastSynchronizedFormRef = useRef<{ adrId: string; form: AdrFormData } | null>(null);
  const apiRef = useRef({ joinFn, pollFn, appendFn });
  apiRef.current = { joinFn, pollFn, appendFn };

  useEffect(() => {
    const initial = initialStateRef.current;
    if (!initial) return;

    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let doc: Y.Doc | undefined;
    let lastId = 0;
    let pendingUpdates: Uint8Array[] = [];
    let errorReported = false;

    const reportError = (error: unknown) => {
      if (errorReported) return;
      errorReported = true;
      toast.error(error instanceof Error ? error.message : "ADR collaboration disconnected.");
    };

    const flushUpdates = async () => {
      flushTimer = undefined;
      if (!active || pendingUpdates.length === 0) return;
      const updates = pendingUpdates;
      pendingUpdates = [];
      const mergedUpdate = Y.mergeUpdates(updates);
      try {
        await apiRef.current.appendFn({
          data: {
            adr_id: adrId,
            update_data: encodeBase64(mergedUpdate),
          },
        });
      } catch (error) {
        pendingUpdates = [...updates, ...pendingUpdates];
        reportError(error);
        if (active) flushTimer = setTimeout(() => void flushUpdates(), 2_000);
      }
    };

    const scheduleFlush = () => {
      if (!flushTimer) flushTimer = setTimeout(() => void flushUpdates(), 100);
    };

    const poll = async () => {
      if (!active) return;
      try {
        const updates = await apiRef.current.pollFn({ data: { adr_id: adrId, after_id: lastId } });
        for (const update of updates) {
          if (!active) return;
          Y.applyUpdate(doc!, decodeBase64(update.update_data), REMOTE_ORIGIN);
          lastId = Math.max(lastId, Number(update.id));
        }
        errorReported = false;
        pollTimer = setTimeout(() => void poll(), 600);
      } catch (error) {
        reportError(error);
        pollTimer = setTimeout(() => void poll(), 2_000);
      }
    };

    const start = async () => {
      doc = new Y.Doc();
      docRef.current = doc;
      const candidateSnapshot = encodeState(initial);
      const room = await apiRef.current.joinFn({
        data: { adr_id: adrId, initial_snapshot: candidateSnapshot },
      });
      if (!active) return;
      Y.applyUpdate(doc, decodeBase64(room.snapshot), REMOTE_ORIGIN);
      for (const update of room.updates) {
        Y.applyUpdate(doc, decodeBase64(update.update_data), REMOTE_ORIGIN);
        lastId = Math.max(lastId, Number(update.id));
      }
      const applyState = () => {
        if (!active) return;
        try {
          onRemoteChangeRef.current?.(readState(doc!));
        } catch (error) {
          reportError(error);
        }
      };
      doc.on("update", (update, origin) => {
        if (origin !== REMOTE_ORIGIN) {
          pendingUpdates.push(update);
          scheduleFlush();
        }
        applyState();
      });
      applyState();
      setReady(true);
      void poll();
    };

    void start().catch((error: unknown) => reportError(error));

    return () => {
      active = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (docRef.current === doc) docRef.current = null;
      doc?.destroy();
      setReady(false);
    };
  }, [adrId, Boolean(initialState)]);

  useEffect(() => {
    const doc = docRef.current;
    const form = initialState?.form ?? DEFAULT_ADR_FORM;
    if (!syncLocalFormRef.current || !ready || !doc) return;

    const lastSynchronized = lastSynchronizedFormRef.current;
    if (!lastSynchronized || lastSynchronized.adrId !== adrId) {
      lastSynchronizedFormRef.current = { adrId, form };
      return;
    }
    if (lastSynchronized.form !== form) {
      syncForm(doc, form);
      lastSynchronizedFormRef.current = { adrId, form };
    }
  }, [adrId, initialState?.form, ready]);

  return { ready };
}
