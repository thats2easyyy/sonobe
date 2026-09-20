/**
 * Agent presence: what Claude (or another agent) is working on right now, and a feed of recent
 * agent changes for the AI Activity panel and highlight flashes on layers, patches, and the viewer.
 */

import type { Author, Id } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";

/** The session behind an agent's work, when the host knows it (a Claude Code session in a folder). */
export interface WorkClient {
  id: string;
  /** "Claude Code", "Claude Desktop", or the client's own name. */
  label: string;
  /** The session's project folder. */
  folder?: string;
}

export interface WorkingItem {
  workId: string;
  /** Items being worked on (layers, patches, comments). */
  ids: Id[];
  component?: Id;
  /** Plain-language intent, e.g. "adding a press animation". */
  intent: string;
  author: Author;
  startedAt: number;
  client?: WorkClient;
}

export type AgentChangeKind = "apply" | "undo" | "redo" | "replace" | "finish";

export interface AgentChange {
  id: string;
  kind: AgentChangeKind;
  txnId?: string;
  author: Author;
  label: string;
  /** "Claude: added press animation (12 ops)" */
  description: string;
  /** Layers and patches touched. */
  ids: Id[];
  components: Id[];
  revision: number;
  opCount: number;
  timestamp: number;
}

export interface BeginWorkInput {
  ids?: readonly Id[];
  intent: string;
  author?: Author;
  component?: Id;
  client?: WorkClient;
}

export type RecordChangeInput = Omit<AgentChange, "id" | "description" | "timestamp"> & { description?: string; timestamp?: number };

export interface PresenceState {
  working: WorkingItem[];
  /** Newest first. */
  recent: AgentChange[];
  /** Item id → epoch ms of the latest agent change that touched it. */
  flashes: Record<Id, number>;
  begin: (input: BeginWorkInput) => string;
  update: (workId: string, changes: Partial<Pick<WorkingItem, "ids" | "intent" | "component">>) => void;
  /** End work; with a summary, a "finish" entry is added to the feed. */
  finish: (workId: string, options?: { summary?: string; revision?: number }) => WorkingItem | undefined;
  /** End every work item (optionally only one author's, or only one session's by its client id). */
  finishAll: (author?: Author, clientId?: string) => void;
  recordChange: (change: RecordChangeInput) => AgentChange;
  clearRecent: () => void;
}

export type PresenceStore = StoreApi<PresenceState>;

export interface PresenceStoreOptions {
  /** Feed length. Default 100. */
  maxRecent?: number;
  /** How long an item counts as flashing. Default 1600 ms. */
  flashMs?: number;
  now?: () => number;
}

export const DEFAULT_AGENT: Author = { kind: "agent", name: "Claude" };
export const PRESENCE_FLASH_MS = 1600;

const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.name === b.name;

/** Work items touching an id. */
export function workingOn(state: Pick<PresenceState, "working">, id: Id): WorkingItem[] {
  return state.working.filter((w) => w.ids.includes(id));
}

/** Ids whose latest agent change is still within the flash window. */
export function flashingIds(state: Pick<PresenceState, "flashes">, now: number, flashMs = PRESENCE_FLASH_MS): Set<Id> {
  const out = new Set<Id>();
  for (const [id, at] of Object.entries(state.flashes)) if (now - at <= flashMs) out.add(id);
  return out;
}

export function createPresenceStore(options: PresenceStoreOptions = {}): PresenceStore {
  const maxRecent = Math.max(1, options.maxRecent ?? 100);
  const flashMs = options.flashMs ?? PRESENCE_FLASH_MS;
  const now = options.now ?? (() => Date.now());
  let workCounter = 0;
  let changeCounter = 0;

  return createStore<PresenceState>()((set, get) => {
    const pushFeed = (input: RecordChangeInput): AgentChange => {
      const timestamp = input.timestamp ?? now();
      const change: AgentChange = {
        ...input,
        id: `change_${++changeCounter}`,
        timestamp,
        description: input.description ?? `${input.author.name}: ${input.label}${input.opCount > 1 ? ` (${input.opCount} ops)` : ""}`,
      };
      const flashes: Record<Id, number> = {};
      for (const [id, at] of Object.entries(get().flashes)) if (timestamp - at <= flashMs) flashes[id] = at;
      for (const id of change.ids) flashes[id] = timestamp;
      set({ recent: [change, ...get().recent].slice(0, maxRecent), flashes });
      return change;
    };

    return {
      working: [],
      recent: [],
      flashes: {},
      begin(input) {
        const workId = `work_${++workCounter}`;
        const item: WorkingItem = { workId, ids: [...new Set(input.ids ?? [])], intent: input.intent, author: { ...(input.author ?? DEFAULT_AGENT) }, startedAt: now() };
        if (input.component !== undefined) item.component = input.component;
        if (input.client !== undefined) item.client = { ...input.client };
        set({ working: [...get().working, item] });
        return workId;
      },
      update(workId, changes) {
        const working = get().working.map((w) => (w.workId === workId ? { ...w, ...changes, ...(changes.ids ? { ids: [...new Set(changes.ids)] } : {}) } : w));
        set({ working });
      },
      finish(workId, finishOptions = {}) {
        const item = get().working.find((w) => w.workId === workId);
        if (!item) return undefined;
        set({ working: get().working.filter((w) => w.workId !== workId) });
        if (finishOptions.summary) {
          pushFeed({ kind: "finish", author: item.author, label: finishOptions.summary, ids: item.ids, components: item.component ? [item.component] : [], revision: finishOptions.revision ?? 0, opCount: 0, description: `${item.author.name}: ${finishOptions.summary}` });
        }
        return item;
      },
      finishAll(author, clientId) {
        if (clientId !== undefined) set({ working: get().working.filter((w) => w.client?.id !== clientId) });
        else set({ working: author ? get().working.filter((w) => !sameAuthor(w.author, author)) : [] });
      },
      recordChange: pushFeed,
      clearRecent() {
        set({ recent: [], flashes: {} });
      },
    };
  });
}
