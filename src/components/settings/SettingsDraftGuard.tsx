import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker, UNSAFE_DataRouterContext } from "react-router-dom";

type Draft = { dirty: boolean; discard: () => void };
const DraftContext = createContext<{
  register: (key: symbol, draft: Draft) => () => void;
  request: (action: () => void) => void;
} | null>(null);

function RouteBlocker({ dirty, discard }: { dirty: () => boolean; discard: () => void }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty() &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  return blocker.state === "blocked" ? <DiscardDialog keep={() => blocker.reset()} discard={() => {
    discard();
    blocker.proceed();
  }} /> : null;
}

function DiscardDialog({ keep, discard }: { keep: () => void; discard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const previous = useRef<Element | null>(null);
  function keepEditing() {
    ref.current?.close();
    if (previous.current instanceof HTMLElement) previous.current.focus();
    keep();
  }
  useEffect(() => {
    previous.current = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={ref} className="settings-discard-dialog" aria-labelledby="discard-heading" onCancel={(e) => { e.preventDefault(); keepEditing(); }}>
    <h2 id="discard-heading">Discard unsaved changes?</h2>
    <div className="settings-actions"><button type="button" onClick={keepEditing}>Keep editing</button><button type="button" onClick={discard}>Discard changes</button></div>
  </dialog>;
}

export function SettingsDraftGuard({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<symbol, Draft>());
  const [pending, setPending] = useState<(() => void) | null>(null);
  const router = useContext(UNSAFE_DataRouterContext);
  const dirty = () => [...drafts.current.values()].some((draft) => draft.dirty);
  const discard = () => { for (const draft of drafts.current.values()) if (draft.dirty) draft.discard(); };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return <DraftContext value={{
    register: (key, draft) => { drafts.current.set(key, draft); return () => { drafts.current.delete(key); }; },
    request: (action) => { if (dirty()) setPending(() => action); else action(); },
  }}>
    {children}
    {router && <RouteBlocker dirty={dirty} discard={discard} />}
    {pending && <DiscardDialog keep={() => setPending(null)} discard={() => { discard(); pending(); setPending(null); }} />}
  </DraftContext>;
}

export function useSettingsDraft(dirty: boolean, discard: () => void) {
  const context = useContext(DraftContext);
  const key = useRef(Symbol());
  useEffect(() => context?.register(key.current, { dirty, discard }), [context, dirty, discard]);
  return context?.request ?? ((action: () => void) => action());
}
