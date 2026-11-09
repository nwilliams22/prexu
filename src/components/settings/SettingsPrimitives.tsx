import { useId, type ReactNode, type InputHTMLAttributes } from "react";
import "./settings.css";

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ id, title, description, children }: SettingsSectionProps) {
  const generatedId = useId();
  const sectionId = id ?? generatedId;
  return <section className="settings-section" id={sectionId} aria-labelledby={`${sectionId}-heading`}>
    <h3 id={`${sectionId}-heading`} tabIndex={-1}>{title}</h3>
    {description && <p className="settings-help">{description}</p>}
    {children}
  </section>;
}

export interface SettingsControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface SettingsRowProps {
  id: string;
  label: string;
  help?: string;
  error?: string;
  status?: ReactNode;
  children: (props: SettingsControlProps) => ReactNode;
}

/** Render props associate the actual native control with its label and feedback. */
export function SettingsRow({ id, label, help, error, status, children }: SettingsRowProps) {
  const descriptions = [help && `${id}-help`, error && `${id}-error`, status && `${id}-status`].filter(Boolean).join(" ");
  return <div className="settings-row" id={`${id}-row`}>
    <div className="settings-row-copy">
      <label htmlFor={id} id={`${id}-label`} tabIndex={-1}>{label}</label>
      {help && <p className="settings-help" id={`${id}-help`}>{help}</p>}
    </div>
    <div className="settings-row-control">
      {children({ id, "aria-describedby": descriptions || undefined, "aria-invalid": error ? true : undefined })}
      {error && <p className="settings-error" id={`${id}-error`} aria-live="polite">{error}</p>}
      {status && <div id={`${id}-status`}>{status}</div>}
    </div>
  </div>;
}

interface SettingsRangeProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "step"> {
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
}

export function SettingsRange({ value, min, max, step, formatValue = String, ...props }: SettingsRangeProps) {
  return <div className="settings-range">
    <output htmlFor={props.id}>{formatValue(value)}</output>
    <input {...props} type="range" value={value} min={min} max={max} step={step} aria-valuetext={formatValue(value)} />
    <div className="settings-range-endpoints" aria-hidden="true"><span>{formatValue(min)}</span><span>{formatValue(max)}</span></div>
  </div>;
}

interface SettingsChoiceGroupProps {
  id: string;
  legend: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}

export function SettingsChoiceGroup({ id, legend, value, options, onChange, disabled, "aria-describedby": describedBy }: SettingsChoiceGroupProps) {
  return <fieldset className="settings-choice-group" id={id} disabled={disabled} aria-describedby={describedBy}>
    <legend>{legend}</legend>
    <div>{options.map((option) => <label key={option.value}>
      <input type="radio" name={id} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
      {option.label}
    </label>)}</div>
  </fieldset>;
}
