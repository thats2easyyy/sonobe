import { FileBox } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { SearchList } from "../ui/SearchList.tsx";
import { TextField } from "../ui/TextField.tsx";
import type { FuzzyKey } from "../ui/lib/fuzzy.ts";
import { appDialogs, useAppDialogs, type AppDialogRequest, type AppDialogStore } from "./dialogs.ts";

const NAME_KEYS: FuzzyKey<string>[] = [{ name: "name", get: (n) => n }];

/** Shows the front request of the app dialog queue. Render once near the root. */
export function AppDialogs({ store = appDialogs }: { store?: AppDialogStore }) {
  const request = useAppDialogs((s) => s.queue[0] ?? null, store);
  if (!request) return null;
  const settle = (value: string | null | "save" | "discard" | "cancel") => store.getState().settle(request.id, value);
  switch (request.kind) {
    case "promptName":
      return <NameDialog key={request.id} request={request} onSettle={settle} />;
    case "pickProject":
      return <PickDialog key={request.id} request={request} onSettle={settle} />;
    case "confirmDiscard":
      return <DiscardDialog key={request.id} request={request} onSettle={settle} />;
  }
}

type Settle = (value: string | null | "save" | "discard" | "cancel") => void;

function NameDialog({ request, onSettle }: { request: Extract<AppDialogRequest, { kind: "promptName" }>; onSettle: Settle }) {
  const titleId = useId();
  const [name, setName] = useState(request.defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);
  const trimmed = name.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(null)} aria-labelledby={titleId} width={420} className="sb-appdialog" initialFocusRef={inputRef}>
      <form
        className="sb-appdialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSettle(trimmed);
        }}
      >
        <h2 id={titleId} className="sb-appdialog__title">
          Save prototype
        </h2>
        <p className="sb-appdialog__text">Prototypes you save here stay in this browser. Give it a name you’ll recognize.</p>
        <TextField ref={inputRef} aria-label="Prototype name" value={name} onChange={(event) => setName(event.target.value)} onCancel={() => onSettle(null)} />
        <div className="sb-appdialog__actions">
          <Button onClick={() => onSettle(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!trimmed}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PickDialog({ request, onSettle }: { request: Extract<AppDialogRequest, { kind: "pickProject" }>; onSettle: Settle }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(null)} aria-label="Open prototype" placement="top" width={480} modalScope="openProject" className="sb-appdialog sb-appdialog--list">
      <SearchList
        aria-label="Saved prototypes"
        placeholder="Open a saved prototype…"
        items={request.names}
        keys={NAME_KEYS}
        getId={(n) => n}
        onSelect={(n) => onSettle(n)}
        emptyState={(query) => `No saved prototype matches “${query}”.`}
        renderItem={(n, ctx) => (
          <div className="sb-appdialog__item">
            <FileBox size={14} strokeWidth={1.75} aria-hidden />
            <span className="sb-appdialog__item-name">{ctx.highlight("name", n)}</span>
          </div>
        )}
      />
    </Dialog>
  );
}

const DISCARD_VERBS = { open: "opening another prototype", new: "starting a new prototype", reload: "reloading" } as const;

function DiscardDialog({ request, onSettle }: { request: Extract<AppDialogRequest, { kind: "confirmDiscard" }>; onSettle: Settle }) {
  const titleId = useId();
  const saveRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle("cancel")} aria-labelledby={titleId} width={440} className="sb-appdialog" initialFocusRef={saveRef} closeOnOverlayClick={false}>
      <div className="sb-appdialog__body">
        <h2 id={titleId} className="sb-appdialog__title">
          Save changes to “{request.name}”?
        </h2>
        <p className="sb-appdialog__text">You have unsaved changes. Save them before {DISCARD_VERBS[request.action]}, or they’ll be lost.</p>
        <div className="sb-appdialog__actions">
          <Button variant="ghost" className="sb-appdialog__discard" onClick={() => onSettle("discard")}>
            Don’t Save
          </Button>
          <Button onClick={() => onSettle("cancel")}>Cancel</Button>
          <Button ref={saveRef} variant="primary" onClick={() => onSettle("save")}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
