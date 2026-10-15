import { useState } from "react";
import { formatEstimateHours, parseEstimateHours } from "../../../../src/lib/estimateHours.ts";

type Props = {
  id?: string;
  value: number | null | undefined;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
  onCommit: (next: number | null) => void;
};

export function HoursInput({ id, value, disabled, ariaLabel, className, placeholder, onCommit }: Props) {
  const display = formatEstimateHours(value);
  const [text, setText] = useState(display);
  const [synced, setSynced] = useState(display);
  const [invalid, setInvalid] = useState(false);
  if (display !== synced) {
    setSynced(display);
    setText(display);
    setInvalid(false);
  }

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      max={999.75}
      step={0.25}
      className={className}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      title={invalid ? "Use quarter hours, such as 1.25" : "Hours"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        const parsed = parseEstimateHours(text);
        if (parsed === "invalid") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        setText(formatEstimateHours(parsed));
        if (parsed !== (value ?? null)) onCommit(parsed);
      }}
    />
  );
}
