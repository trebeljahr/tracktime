import type { JSX } from "react";

/**
 * An on/off control that commits the moment it is clicked.
 *
 * A switch rather than a checkbox because there is no form to submit anywhere
 * in this popup: the tracker's billable flag writes straight to the running
 * entry, and every settings toggle writes one `settings.update`. A checkbox
 * would promise a Save button that does not exist.
 *
 * Generalised out of the tracker's billable button, whose struck-through mark
 * is kept as a variant: "not billable" has to read as a state rather than as a
 * disabled control, which a plain empty circle does not manage.
 */

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The whole label, so a caller can word the two states differently. */
  label: string;
  disabled?: boolean;
  /** `struck` draws the off state with a line through the mark. */
  variant?: "plain" | "struck";
  testId?: string;
};

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  variant = "plain",
  testId,
}: SwitchProps): JSX.Element {
  const classes = ["switch"];
  if (checked) classes.push("switch--on");
  if (variant === "struck") classes.push("switch--struck");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={classes.join(" ")}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      data-checked={checked ? "true" : "false"}
    >
      <span aria-hidden="true" className="switch__mark" />
      {label}
    </button>
  );
}
