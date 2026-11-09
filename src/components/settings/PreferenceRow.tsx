import type { ReactNode } from "react";
import type { PreferencePath } from "../../hooks/preferencePersistence";
import { PreferenceSaveStatus, preferenceRows } from "./PreferenceSaveStatus";
import { SettingsRow, type SettingsControlProps } from "./SettingsPrimitives";

/** Inventory IDs keep save feedback, labels and navigation targets together. */
export function PreferenceRow({ path, label, help, children }: {
  path: PreferencePath;
  label?: string;
  help?: string;
  children: (props: SettingsControlProps) => ReactNode;
}) {
  const [id, , defaultLabel] = preferenceRows[path];
  return <SettingsRow id={id} label={label ?? defaultLabel} help={help} status={<PreferenceSaveStatus path={path} />}>
    {(props) => children({ ...props, "aria-describedby": `${props["aria-describedby"]} preference-${id}` })}
  </SettingsRow>;
}
