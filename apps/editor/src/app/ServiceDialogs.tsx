import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { DialogRequest, DialogStore, DialogVariant, PickDialogItem } from "../state/dialogs.ts";
import { Button, type ButtonVariant } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { SearchList } from "../ui/SearchList.tsx";
import { TextField } from "../ui/TextField.tsx";
import type { FuzzyKey } from "../ui/lib/fuzzy.ts";
import "./dialogs.css";

type Settle = (value: boolean | string | null) => void;

/** Shows the front request of the state dialog service (confirm, prompt, choose, pick). Render once. */
export function ServiceDialogs({ store }: { store: DialogStore }) {
  const request = useStore(store, (s) => s.queue[0] ?? null);
  if (!request) return null;
  const settle: Settle = (value) => store.getState().settle(request.id, value);
  switch (request.kind) {
    case "confirm":
      return <ConfirmDialog key={request.id} request={request} onSettle={settle} />;
    case "prompt":
      return <PromptDialog key={request.id} request={request} onSettle={settle} />;
    case "choose":
      return <ChooseDialog key={request.id} request={request} onSettle={settle} />;
    case "pick":
      return <PickDialog key={request.id} request={request} onSettle={settle} />;
  }
}

const VARIANTS: Record<DialogVariant, ButtonVariant> = { primary: "primary", danger: "danger", default: "secondary" };

function ConfirmDialog({ request, onSettle }: { request: Extract<DialogRequest, { kind: "confirm" }>; onSettle: Settle }) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { title, message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false } = request.options;
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(false)} aria-labelledby={titleId} width={440} className="sb-appdialog" initialFocusRef={danger ? cancelRef : confirmRef} modalScope="serviceDialog">
      <div className="sb-appdialog__body">
        <h2 id={titleId} className="sb-appdialog__title">
          {title}
        </h2>
        {message && <p className="sb-appdialog__text">{message}</p>}
        <div className="sb-appdialog__actions">
          <Button ref={cancelRef} onClick={() => onSettle(false)}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={danger ? "danger" : "primary"} onClick={() => onSettle(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PromptDialog({ request, onSettle }: { request: Extract<DialogRequest, { kind: "prompt" }>; onSettle: Settle }) {
  const titleId = useId();
  const errorId = useId();
  const { title, message, defaultValue = "", placeholder, label, confirmLabel = "OK", cancelLabel = "Cancel", validate } = request.options;
  const [value, setValue] = useState(defaultValue);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);
  const problem = validate?.(value) ?? null;
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(null)} aria-labelledby={titleId} width={420} className="sb-appdialog" initialFocusRef={inputRef} modalScope="serviceDialog">
      <form
        className="sb-appdialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!problem) onSettle(value);
        }}
      >
        <h2 id={titleId} className="sb-appdialog__title">
          {title}
        </h2>
        {message && <p className="sb-appdialog__text">{message}</p>}
        <TextField
          ref={inputRef}
          aria-label={label ?? title}
          value={value}
          placeholder={placeholder}
          invalid={touched && !!problem}
          aria-describedby={touched && problem ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setTouched(true);
          }}
          onCancel={() => onSettle(null)}
        />
        {touched && problem && (
          <p id={errorId} className="sb-appdialog__error" role="alert">
            {problem}
          </p>
        )}
        <div className="sb-appdialog__actions">
          <Button onClick={() => onSettle(null)}>{cancelLabel}</Button>
          <Button type="submit" variant="primary" disabled={!!problem}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChooseDialog({ request, onSettle }: { request: Extract<DialogRequest, { kind: "choose" }>; onSettle: Settle }) {
  const titleId = useId();
  const { title, message, actions } = request.options;
  const focusRef = useRef<HTMLButtonElement>(null);
  const start = actions.filter((a) => a.align === "start");
  const end = actions.filter((a) => a.align !== "start");
  const focused = (end.find((a) => a.variant === "primary") ?? end.at(-1) ?? actions[0])?.value;
  const button = (action: (typeof actions)[number]) =>
    action.align === "start" ? (
      <Button key={action.value} variant="ghost" data-tone={action.variant === "danger" ? "danger" : undefined} onClick={() => onSettle(action.value)}>
        {action.label}
      </Button>
    ) : (
      <Button key={action.value} ref={action.value === focused ? focusRef : undefined} variant={VARIANTS[action.variant ?? "default"]} onClick={() => onSettle(action.value)}>
        {action.label}
      </Button>
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(null)} aria-labelledby={titleId} width={460} className="sb-appdialog" initialFocusRef={focusRef} modalScope="serviceDialog">
      <div className="sb-appdialog__body">
        <h2 id={titleId} className="sb-appdialog__title">
          {title}
        </h2>
        {message && <p className="sb-appdialog__text">{message}</p>}
        <div className="sb-appdialog__actions">
          {start.length > 0 && <div className="sb-appdialog__actions-start">{start.map(button)}</div>}
          {end.map(button)}
        </div>
      </div>
    </Dialog>
  );
}

const PICK_KEYS: FuzzyKey<PickDialogItem>[] = [
  { name: "label", get: (i) => i.label },
  { name: "description", get: (i) => i.description, weight: 0.4 },
];

function PickDialog({ request, onSettle }: { request: Extract<DialogRequest, { kind: "pick" }>; onSettle: Settle }) {
  const { title, message, items, emptyMessage } = request.options;
  const list = useMemo(() => [...items], [items]);
  return (
    <Dialog open onOpenChange={(open) => !open && onSettle(null)} aria-label={title} placement="top" width={480} modalScope="serviceDialog" className="sb-appdialog sb-appdialog--list">
      {message && <p className="sb-appdialog__pick-message">{message}</p>}
      <SearchList
        aria-label={title}
        placeholder={`${title}…`}
        items={list}
        keys={PICK_KEYS}
        getId={(item) => item.value}
        onSelect={(item) => onSettle(item.value)}
        emptyState={(query) => (query ? `Nothing matches “${query}”.` : (emptyMessage ?? "There's nothing to pick."))}
        renderItem={(item, ctx) => (
          <div className="sb-appdialog__pick">
            <span className="sb-appdialog__item-name">{ctx.highlight("label", item.label)}</span>
            {item.description && <span className="sb-appdialog__pick-desc">{item.description}</span>}
          </div>
        )}
      />
    </Dialog>
  );
}
