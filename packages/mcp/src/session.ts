/**
 * DocumentSession: one document plus its undo history, revision counter, the ids it has seen (so
 * removed ids retire, ARCHITECTURE §3.2) and cached diagnostics. Hosts wrap it with file IO (HeadlessHost) or keep their own store (the app).
 * Browser-safe.
 */

import {
  applyOps,
  createHistory,
  createDiagnosticsCache,
  createIdLedger,
  describeHistoryEntry,
  type Author,
  type Diagnostic,
  type History,
  type HistoryEntry,
  type Id,
  type Op,
  type SeenIds,
  type SonobeDocument,
} from "@sonobe/core";
import type { EngineRegistry } from "@sonobe/engine";
import {
  HostError,
  type DiagnosticsDelta,
  type DiagnosticTotals,
  type HistoryItem,
  type HostApplyOptions,
  type HostApplyResult,
  type UndoOptions,
  type UndoResult,
} from "./host.ts";

export interface DocumentSessionOptions {
  docId: Id;
  registry: EngineRegistry;
  historyLimit?: number;
  now?: () => number;
}

export interface DocumentSession {
  readonly docId: Id;
  readonly doc: SonobeDocument;
  readonly revision: number;
  readonly dirty: boolean;
  /** Every id seen this session; ids seen in a component and gone from it are retired there. */
  readonly seenIds: SeenIds;
  apply(ops: Op[], options: HostApplyOptions): HostApplyResult;
  undo(options: UndoOptions): UndoResult;
  listHistory(options: { limit?: number; author?: string }): HistoryItem[];
  diagnostics(): Diagnostic[];
  /** Record that the current revision is on disk. */
  markSaved(): void;
  /** Replace the document without history (external reload). */
  replace(doc: SonobeDocument): void;
}

/** A stable key for "the same problem" across revisions. */
export function diagnosticKey(d: Diagnostic): string {
  return `${d.code}|${d.component}|${[...d.itemIds].sort().join(",")}|${d.port ?? ""}`;
}

export function diagnosticTotals(list: readonly Diagnostic[]): DiagnosticTotals {
  const totals: DiagnosticTotals = { errors: 0, warnings: 0, info: 0 };
  for (const d of list) {
    if (d.severity === "error") totals.errors++;
    else if (d.severity === "warning") totals.warnings++;
    else totals.info++;
  }
  return totals;
}

/** Diagnostics added and resolved between two passes. */
export function diffDiagnostics(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
): DiagnosticsDelta {
  const beforeKeys = new Set(before.map(diagnosticKey));
  const afterKeys = new Set(after.map(diagnosticKey));
  return {
    added: after.filter((d) => !beforeKeys.has(diagnosticKey(d))),
    resolved: before.filter((d) => !afterKeys.has(diagnosticKey(d))),
    totals: diagnosticTotals(after),
  };
}

/** "added 2 layers, 3 patches and 4 connections" */
export function describeOps(ops: readonly Op[]): string {
  const counts = new Map<string, number>();
  const bump = (key: string, n = 1) => counts.set(key, (counts.get(key) ?? 0) + n);
  for (const op of ops) {
    switch (op.op) {
      case "addLayer":
        bump("added layer");
        break;
      case "addPatch":
        bump("added patch");
        break;
      case "connect":
        bump("connected input");
        break;
      case "setInput":
        bump(
          op.value !== null && typeof op.value === "object" && "link" in op.value
            ? "connected input"
            : "set value",
        );
        break;
      case "disconnect":
        bump("disconnected input");
        break;
      case "removeLayer":
      case "removePatch":
      case "removeComment":
        bump("deleted item");
        break;
      case "updateLayer":
        bump("updated layer");
        break;
      case "updatePatch":
        bump("updated patch");
        break;
      case "rename":
        bump("renamed item");
        break;
      case "moveLayer":
        bump("moved layer");
        break;
      case "createComponent":
      case "addComponent":
        bump("created component");
        break;
      default:
        bump("changed document");
    }
  }
  const parts = [...counts].map(([label, n]) => {
    const [verb, noun] = label.split(" ") as [string, string];
    return { verb, text: `${n} ${noun}${n === 1 ? "" : "s"}` };
  });
  if (!parts.length) return "no changes";
  const byVerb = new Map<string, string[]>();
  for (const p of parts) byVerb.set(p.verb, [...(byVerb.get(p.verb) ?? []), p.text]);
  const join = (items: string[]) =>
    items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  return [...byVerb].map(([verb, items]) => `${verb} ${join(items)}`).join("; ");
}

export function historyItem(entry: HistoryEntry): HistoryItem {
  return {
    txnId: entry.txnId,
    label: entry.label,
    author: entry.author,
    revision: entry.revision,
    opCount: entry.ops.length,
    timestamp: entry.timestamp,
    summary: describeHistoryEntry(entry),
  };
}

function matchesAuthor(author: Author, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === "human" || filter === "agent") return author.kind === filter;
  return author.name.toLowerCase() === filter.toLowerCase();
}

export function createDocumentSession(
  initial: SonobeDocument,
  options: DocumentSessionOptions,
): DocumentSession {
  const registry = options.registry;
  const history: History = createHistory({
    limit: options.historyLimit ?? 500,
    ...(options.now ? { now: options.now } : {}),
  });
  let doc = initial;
  let savedRevision = 0;
  const ids = createIdLedger(initial);
  // Incremental: a small write re-checks only what it changed.
  const diagnosticsCache = createDiagnosticsCache(registry);
  const diagnostics = (): Diagnostic[] => diagnosticsCache.get(doc);

  const emptyDelta = (): DiagnosticsDelta => ({
    added: [],
    resolved: [],
    totals: diagnosticTotals(diagnostics()),
  });

  const session: DocumentSession = {
    docId: options.docId,
    get doc() {
      return doc;
    },
    get revision() {
      return history.revision;
    },
    get dirty() {
      return history.revision !== savedRevision;
    },
    seenIds: ids,

    apply(ops, applyOptions) {
      const base = {
        docId: options.docId,
        dryRun: !!applyOptions.dryRun,
        idMap: {},
        affected: { components: [], layers: [], patches: [] },
        applied: [],
      };
      if (
        applyOptions.expectedRevision !== undefined &&
        applyOptions.expectedRevision !== history.revision
      ) {
        const error = {
          code: "revision_conflict",
          message: `The document changed since revision ${applyOptions.expectedRevision}; it's at revision ${history.revision} now. Nothing was applied.`,
          hint: "Re-read what you're changing (get_outline or get_items), then retry with expectedRevision set to the current revision.",
        };
        return {
          ...base,
          ok: false,
          revision: history.revision,
          results: [],
          errors: [error],
          diagnostics: emptyDelta(),
          conflict: {
            expectedRevision: applyOptions.expectedRevision,
            currentRevision: history.revision,
          },
        };
      }
      const before = diagnostics();
      const result = applyOps(doc, ops, {
        registry,
        atomic: applyOptions.atomic !== false,
        dryRun: !!applyOptions.dryRun,
        seenIds: ids,
        ...(applyOptions.defaultComponent !== undefined
          ? { defaultComponent: applyOptions.defaultComponent }
          : {}),
      });
      const out: HostApplyResult = {
        ok: result.ok,
        docId: options.docId,
        revision: history.revision,
        dryRun: !!applyOptions.dryRun,
        results: result.results,
        errors: result.errors,
        idMap: result.idMap,
        affected: result.affected,
        applied: result.applied,
        diagnostics: emptyDelta(),
      };
      if (applyOptions.dryRun) {
        if (result.preview) {
          out.preview = result.preview;
          out.diagnostics = diffDiagnostics(before, diagnosticsCache.get(result.preview));
        }
        return out;
      }
      if (!result.applied.length) return out;
      doc = result.doc;
      ids.observe(doc, result.affected.components);
      const entry = history.push({
        label: applyOptions.label,
        author: applyOptions.author,
        ops: result.applied,
        inverse: result.inverse,
      });
      out.revision = history.revision;
      out.txnId = entry.txnId;
      out.diagnostics = diffDiagnostics(before, diagnostics());
      return out;
    },

    undo(undoOptions) {
      const top = history.peekUndo();
      if (!top)
        throw new HostError(
          "nothing_to_undo",
          "There's nothing to undo in this document's history.",
          { hint: "list_history shows what's been recorded since the document was opened." },
        );
      let targetId = undoOptions.txnId;
      if (targetId === undefined) {
        if (top.author.kind === "human" && !undoOptions.allowHumanEdits) {
          throw new HostError(
            "human_edit",
            `The newest change was made by ${top.author.name}: "${top.label}". Undoing it would throw away their work.`,
            {
              hint: `Ask before undoing someone else's edit. To undo it anyway, pass txnId "${top.txnId}".`,
            },
          );
        }
        targetId = top.txnId;
      }
      const entries = history.entries();
      const index = entries.findIndex((e) => e.txnId === targetId);
      if (index < 0) {
        throw new HostError("not_found", `There's no undoable history entry "${targetId}".`, {
          hint: entries.length
            ? `Newest entries: ${entries
                .slice(0, 5)
                .map((e) => `${e.txnId} (${e.label})`)
                .join(", ")}.`
            : "The history is empty.",
        });
      }
      const humans = entries
        .slice(0, index + 1)
        .filter((e) => e.author.kind === "human" && e.txnId !== targetId);
      if (humans.length && !undoOptions.allowHumanEdits) {
        throw new HostError(
          "human_edit",
          `Undoing back to "${entries[index]!.label}" would also undo ${humans.length} newer change${humans.length === 1 ? "" : "s"} made by ${humans[0]!.author.name}.`,
          {
            hint: "Ask the person first; to go ahead anyway, pass allowHumanEdits: true.",
          },
        );
      }
      const before = diagnostics();
      const steps = history.undoTo(targetId)!;
      let next: SonobeDocument | undefined = doc;
      const touched = new Set<Id>();
      for (const step of steps) {
        const r = applyOps(next, step.ops, { registry, lenient: true });
        if (!r.ok) {
          next = undefined;
          break;
        }
        next = r.doc;
        for (const id of r.affected.components) touched.add(id);
      }
      if (!next) {
        for (let i = 0; i < steps.length; i++) history.redo();
        throw new HostError(
          "undo_failed",
          `Couldn't undo "${entries[index]!.label}": later edits changed the same items, so the saved inverse no longer applies.`,
          {
            hint: "Fix it forward with new ops instead (get_items shows the current state).",
          },
        );
      }
      doc = next;
      ids.observe(doc, touched);
      return {
        docId: options.docId,
        revision: history.revision,
        undone: steps.map((s) => historyItem(s.entry)),
        diagnostics: diffDiagnostics(before, diagnostics()),
      };
    },

    listHistory({ limit, author }) {
      return history
        .entries()
        .filter((e) => matchesAuthor(e.author, author))
        .slice(0, limit ?? 20)
        .map(historyItem);
    },

    diagnostics,

    markSaved() {
      savedRevision = history.revision;
    },

    replace(next) {
      doc = next;
      // A reload continues the session: ids the reload removed stay retired.
      ids.observe(doc);
      history.clear();
      savedRevision = history.revision;
    },
  };
  return session;
}
