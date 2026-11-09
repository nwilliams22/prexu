import { logger } from "../services/logger";
import type { Preferences } from "../types/preferences";
import { getDefaultPreferences, getPreferences, getUserPreferences, savePreferences, saveUserPreferences } from "../services/storage";

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type LeafPaths<T> = { [K in keyof T & string]: T[K] extends object ? `${K}.${LeafPaths<T[K]>}` : K }[keyof T & string];
export type PreferencePath = LeafPaths<Preferences>;
export type SaveState = "saving" | "saved" | "error";
export interface PreferenceSnapshot {
  preferences: Preferences;
  loadState: "loading" | "ready" | "error";
  saveStates: Partial<Record<PreferencePath, SaveState>>;
}

// Shared across provider lifetimes: returning to a profile must read after its
// previous writes, even when that provider has already unmounted.
const queues = new Map<number | null, Promise<void>>();
function enqueue(scope: number | null, operation: () => Promise<void>) {
  const next = (queues.get(scope) ?? Promise.resolve()).then(operation);
  const settled = next.catch(() => {});
  queues.set(scope, settled);
  void settled.then(() => { if (queues.get(scope) === settled) queues.delete(scope); });
  return next;
}

function leaves(value: object, prefix = ""): [PreferencePath, unknown][] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === "object" ? leaves(child, path) : [[path as PreferencePath, child]];
  });
}
function read(value: Preferences, path: PreferencePath): unknown {
  return path.split(".").reduce((node, key) => (node as Record<string, unknown>)[key], value as unknown);
}
function patch(value: Preferences, entries: [PreferencePath, unknown][]): Preferences {
  const next = structuredClone(value);
  for (const [path, replacement] of entries) {
    const parts = path.split(".");
    let node = next as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
    node[parts.at(-1)!] = replacement;
  }
  return next;
}

/** One active profile's drafts and confirmed values; no React updater side effects. */
export class PreferencePersistence {
  private snapshot: PreferenceSnapshot = { preferences: getDefaultPreferences(), loadState: "loading", saveStates: {} };
  private confirmed = this.snapshot.preferences;
  private listeners = new Set<() => void>();
  private versions = new Map<PreferencePath, number>();
  private timers = new Map<PreferencePath, ReturnType<typeof setTimeout>>();
  private active = false;
  private generation = 0;
  constructor(private scope: number | null) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<PreferenceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  activate = () => {
    this.active = true;
    this.retryLoad();
    return () => {
      this.active = false;
      this.generation++;
      this.timers.forEach(clearTimeout);
      this.timers.clear();
    };
  };
  retryLoad = () => {
    if (!this.active || this.snapshot.loadState === "ready") return;
    const generation = ++this.generation;
    this.publish({ loadState: "loading" });
    void enqueue(this.scope, async () => {
      try {
        const preferences = this.scope ? await getUserPreferences(this.scope) : await getPreferences();
        if (!this.active || generation !== this.generation) return;
        this.confirmed = preferences;
        this.publish({ preferences, loadState: "ready" });
      } catch {
        void logger.warn("preferences", "Could not load preferences");
        if (this.active && generation === this.generation) this.publish({ loadState: "error" });
      }
    });
  };
  updatePreferences = (partial: DeepPartial<Preferences>) => {
    if (!this.active || this.snapshot.loadState !== "ready") return;
    const entries = leaves(partial).filter(([path, value]) => value !== undefined && (read(this.snapshot.preferences, path) !== value || this.snapshot.saveStates[path] === "error"));
    this.save(entries);
  };
  private save(entries: [PreferencePath, unknown][]) {
    if (!entries.length) return;
    const versions = entries.map(([path]) => {
      const version = (this.versions.get(path) ?? 0) + 1;
      this.versions.set(path, version);
      clearTimeout(this.timers.get(path));
      return version;
    });
    const saveStates = { ...this.snapshot.saveStates };
    entries.forEach(([path]) => { saveStates[path] = "saving"; });
    this.publish({ preferences: patch(this.snapshot.preferences, entries), saveStates });
    void enqueue(this.scope, async () => {
      // Only this operation's values join the confirmed snapshot. Failed drafts
      // in other rows must not be silently saved by an unrelated change.
      const next = patch(this.confirmed, entries);
      let state: SaveState;
      try {
        if (this.scope) await saveUserPreferences(this.scope, next);
        else await savePreferences(next);
        this.confirmed = next;
        state = "saved";
      } catch {
        state = "error";
        void logger.warn("preferences", "Could not save preferences");
      }
      if (!this.active) return;
      const states = { ...this.snapshot.saveStates };
      entries.forEach(([path], index) => {
        if (this.versions.get(path) !== versions[index]) return;
        states[path] = state;
        if (state === "saved") this.timers.set(path, setTimeout(() => {
          if (!this.active || this.versions.get(path) !== versions[index]) return;
          const current = { ...this.snapshot.saveStates };
          delete current[path];
          this.timers.delete(path);
          this.publish({ saveStates: current });
        }, 2000));
      });
      this.publish({ saveStates: states });
    });
  }
  retryPreference = (path: PreferencePath) => {
    if (this.active && this.snapshot.saveStates[path] === "error") this.save([[path, read(this.snapshot.preferences, path)]]);
  };
  revertPreference = (path: PreferencePath) => {
    if (!this.active || this.snapshot.saveStates[path] !== "error") return;
    const states = { ...this.snapshot.saveStates };
    delete states[path];
    this.publish({ preferences: patch(this.snapshot.preferences, [[path, read(this.confirmed, path)]]), saveStates: states });
  };
  resetPreferences = () => this.updatePreferences(getDefaultPreferences());
}
