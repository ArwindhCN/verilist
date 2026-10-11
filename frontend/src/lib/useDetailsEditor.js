import { useCallback, useState } from "react";
import { buildDetailsJson, emptyForm, formFromJson, validateForm, validateRawJson } from "./details.js";

/** State for one details editor. `json` is the exact string that would be sent to the contract. */
export function useDetailsEditor(initialJson = "") {
  const [mode, setMode] = useState("form");
  const [form, setForm] = useState(() => (initialJson ? formFromJson(initialJson).form : emptyForm()));
  const [raw, setRaw] = useState(initialJson);
  const [switchError, setSwitchError] = useState(null);

  const json = mode === "form" ? buildDetailsJson(form) : raw;
  const problems = mode === "form" ? validateForm(form) : validateRawJson(raw).ok ? [] : [validateRawJson(raw).error];

  const switchMode = useCallback(
    (next) => {
      if (next === mode) return;
      setSwitchError(null);
      if (next === "raw") {
        setRaw(buildDetailsJson(form));
        setMode("raw");
        return;
      }
      const parsed = formFromJson(raw);
      if (!parsed.ok) {
        setSwitchError(`Fix the JSON before switching back to the form. ${parsed.error}`);
        return;
      }
      setForm(parsed.form);
      setMode("form");
    },
    [mode, form, raw]
  );

  /** Replace the contents (used to prefill from the latest on-chain version, or to clear after saving). */
  const reset = useCallback((nextJson) => {
    setSwitchError(null);
    setRaw(nextJson);
    setForm(nextJson ? formFromJson(nextJson).form : emptyForm());
  }, []);

  return { mode, form, setForm, raw, setRaw, json, problems, switchMode, switchError, reset };
}
