import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { SettingsChoiceGroup, SettingsRange, SettingsRow, SettingsSection } from "./SettingsPrimitives";

describe("Settings primitives", () => {
  it("associates control labels, help and errors", () => {
    render(<SettingsSection title="Video"><SettingsRow id="quality" label="Quality" help="Choose a resolution." error="Not saved">
      {(props) => <select {...props}><option>Original</option></select>}
    </SettingsRow></SettingsSection>);
    expect(screen.getByRole("region", { name: "Video" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Quality" })).toHaveAccessibleDescription("Choose a resolution. Not saved");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("exposes range units and endpoints", () => {
    render(<SettingsRow id="offset" label="Audio offset">{(props) => <SettingsRange {...props} min={0} max={500} step={10} value={120} readOnly formatValue={(value) => `${value} ms`} />}</SettingsRow>);
    expect(screen.getByRole("slider", { name: "Audio offset" })).toHaveAttribute("aria-valuetext", "120 ms");
    expect(screen.getByText("0 ms")).toBeInTheDocument();
    expect(screen.getByText("500 ms")).toBeInTheDocument();
  });

  it("uses native radio keyboard navigation and a fieldset legend", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<SettingsChoiceGroup id="theme" legend="Theme" value="dark" onChange={change} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />);
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(change).toHaveBeenCalledWith("light");
  });
});
