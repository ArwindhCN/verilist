// A dropdown of known accounts plus an "Other address…" option with a manual input.
import { useState } from "react";
import { isAddress } from "ethers";

const OTHER = "__other__";

export function AddressPicker({ id, label, value, onChange, options, hint }) {
  const [manual, setManual] = useState(() => value !== "" && !options.some((o) => o.address === value));
  const showInput = manual;
  const invalid = showInput && value !== "" && !isAddress(value);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={showInput ? OTHER : value}
        onChange={(event) => {
          if (event.target.value === OTHER) {
            setManual(true);
            onChange("");
          } else {
            setManual(false);
            onChange(event.target.value);
          }
        }}
      >
        <option value="" disabled>
          Choose…
        </option>
        {options.map((option) => (
          <option key={option.address} value={option.address}>
            {option.label}
          </option>
        ))}
        <option value={OTHER}>Other address…</option>
      </select>
      {showInput && (
        <input
          type="text"
          className="mono"
          placeholder="0x…"
          aria-label={`${label}: address`}
          aria-invalid={invalid}
          value={value}
          spellCheck="false"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value.trim())}
        />
      )}
      {invalid && <p className="field-error">That is not a valid wallet address.</p>}
      {hint && !invalid && <p className="field-hint">{hint}</p>}
    </div>
  );
}
