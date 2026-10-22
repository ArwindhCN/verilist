// A dropdown of known accounts plus an "Other address…" option with a manual input.
// With `nameable`, a valid pasted address can be given a friendly name right here (see NicknameEditor).
import { useState } from "react";
import { getAddress, isAddress } from "ethers";
import { NicknameEditor } from "./NicknameEditor.jsx";

const OTHER = "__other__";

export function AddressPicker({ id, label, value, onChange, options, hint, nameable = false }) {
  const [manual, setManual] = useState(() => value !== "" && !options.some((o) => o.address === value));
  // A pasted address that is (or has just become) a known option is shown as that option, not as typed text.
  const known = isAddress(value) ? options.find((o) => o.address.toLowerCase() === value.toLowerCase()) : null;
  const showInput = !known && (manual || value !== "");
  const invalid = showInput && value !== "" && !isAddress(value);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={showInput ? OTHER : (known?.address ?? value)}
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
      {nameable && isAddress(value) && <NicknameEditor key={getAddress(value)} id={`${id}-name`} address={value} />}
      {hint && !invalid && <p className="field-hint">{hint}</p>}
    </div>
  );
}
