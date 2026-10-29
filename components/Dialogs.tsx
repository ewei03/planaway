"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

// In-app replacements for window.prompt() and window.confirm(), which some
// embedded browsers and webviews don't support. Both return promises:
//   const name = await dialogs.ask({ title: "Name your group" });  // string | null
//   if (await dialogs.confirm({ title: "Delete trip?", danger: true })) ...

interface AskOptions {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}

type Request = { id: number } & (
  | ({ kind: "ask"; resolve: (value: string | null) => void } & AskOptions)
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmOptions)
);

interface Dialogs {
  ask: (options: AskOptions) => Promise<string | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const DialogContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs must be used inside <DialogProvider>");
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const nextId = useRef(0);

  const ask = useCallback(
    (options: AskOptions) => new Promise<string | null>((resolve) => setRequest({ id: ++nextId.current, kind: "ask", resolve, ...options })),
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ id: ++nextId.current, kind: "confirm", resolve, ...options })),
    [],
  );

  const [api] = useState<Dialogs>(() => ({ ask, confirm }));

  return (
    <DialogContext.Provider value={api}>
      {children}
      {request && <DialogView key={request.id} request={request} onDone={() => setRequest(null)} />}
    </DialogContext.Provider>
  );
}

function DialogView({ request, onDone }: { request: Request; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const settled = useRef(false);
  const [value, setValue] = useState(request.kind === "ask" ? (request.defaultValue ?? "") : "");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const finish = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (request.kind === "ask") request.resolve(ok ? value.trim() : null);
    else request.resolve(ok);
    ref.current?.close();
    onDone();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (request.kind === "ask" && !value.trim()) return;
    finish(true);
  };

  const danger = request.kind === "confirm" && request.danger;
  const confirmText = request.confirmText ?? (request.kind === "ask" ? "OK" : danger ? "Delete" : "Confirm");

  return (
    <dialog
      ref={ref}
      className="dialog small-dialog"
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) cancels.
        if (e.target === ref.current) finish(false);
      }}
    >
      <form className="dialog-body" onSubmit={submit}>
        <h2 className="small-dialog-title">{request.title}</h2>
        {request.message && <p className="muted">{request.message}</p>}
        {request.kind === "ask" && (
          <>
            {request.label && <label htmlFor="dialog-input">{request.label}</label>}
            <input
              id="dialog-input"
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              aria-label={request.label ?? request.title}
            />
          </>
        )}
        <div className="row-actions dialog-actions">
          <button type="button" className="btn" onClick={() => finish(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${danger ? "danger-fill" : "primary"}`}
            autoFocus={request.kind === "confirm"}
            disabled={request.kind === "ask" && !value.trim()}
          >
            {confirmText}
          </button>
        </div>
      </form>
    </dialog>
  );
}
