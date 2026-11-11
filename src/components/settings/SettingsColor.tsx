import { useId, useRef, useState } from "react";
import "./settings.css";

interface SettingsColorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** WebKitGTK skips native color inputs even with tabIndex. Keep the entry point
 * a button and provide a keyboard-editable hex field alongside the swatch picker. */
export function SettingsColor({ value, onChange, ...props }: SettingsColorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const titleId = useId();
  const hexId = useId();
  const valueId = useId();
  return <>
    <button {...props} type="button" className="settings-color" value={value}
      aria-describedby={[props["aria-describedby"], valueId].filter(Boolean).join(" ")}
      onClick={() => { setDraft(value); dialog.current?.showModal(); }} aria-haspopup="dialog">
      <span className="settings-color-swatch" style={{ backgroundColor: value }} />
      <span id={valueId} className="settings-color-value">{value}</span>
    </button>
    <dialog ref={dialog} className="settings-color-dialog" aria-labelledby={titleId}
      onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
      <form onSubmit={(event) => { event.preventDefault(); onChange(draft); dialog.current?.close(); }}>
        <h3 id={titleId}>Choose color</h3>
        <label htmlFor={hexId}>Hex color</label>
        <input id={hexId} type="text" autoFocus required pattern="#[0-9a-fA-F]{6}" maxLength={7}
          value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
        <p>Enter # followed by six hexadecimal digits (0–9, A–F).</p>
        <input type="color" aria-label="Color picker" value={/^#[0-9a-fA-F]{6}$/.test(draft) ? draft : value}
          onChange={(event) => setDraft(event.target.value)} />
        <div className="settings-color-actions">
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit">Apply</button>
        </div>
      </form>
    </dialog>
  </>;
}
