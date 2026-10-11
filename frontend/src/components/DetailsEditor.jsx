// Editor for a product's details: structured fields (model, category, spec rows, MRP, warranty) that
// build the JSON for the brand, plus a raw JSON mode with validation.
import { byteLength } from "../lib/format.js";
import { MAX_DETAILS_BYTES } from "../lib/details.js";

export function DetailsEditor({ editor, idPrefix }) {
  const { mode, form, setForm, raw, setRaw, problems, switchMode, switchError, json } = editor;
  const update = (patch) => setForm({ ...form, ...patch });
  const size = byteLength(json);

  const setSpec = (index, patch) => update({ specs: form.specs.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const removeSpec = (index) => {
    const next = form.specs.filter((_, i) => i !== index);
    update({ specs: next.length > 0 ? next : [{ key: "", value: "" }] });
  };

  return (
    <div className="editor">
      <div className="segmented" role="group" aria-label="Editing mode">
        <button type="button" aria-pressed={mode === "form"} onClick={() => switchMode("form")}>
          Form
        </button>
        <button type="button" aria-pressed={mode === "raw"} onClick={() => switchMode("raw")}>
          Raw JSON
        </button>
      </div>
      {switchError && <p className="field-error">{switchError}</p>}

      {mode === "form" ? (
        <>
          <div className="grid-2">
            <div className="field">
              <label htmlFor={`${idPrefix}-model`}>Model</label>
              <input id={`${idPrefix}-model`} value={form.model} onChange={(e) => update({ model: e.target.value })} placeholder="Reflex Pro" />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-category`}>Category</label>
              <input id={`${idPrefix}-category`} value={form.category} onChange={(e) => update({ category: e.target.value })} placeholder="Smartwatch" />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-mrp`}>MRP (₹)</label>
              <input id={`${idPrefix}-mrp`} type="number" min="0" step="1" inputMode="numeric" value={form.mrp} onChange={(e) => update({ mrp: e.target.value })} placeholder="2995" />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-warranty`}>Warranty</label>
              <input id={`${idPrefix}-warranty`} value={form.warranty} onChange={(e) => update({ warranty: e.target.value })} placeholder="1 year" />
            </div>
          </div>

          <fieldset className="specs-editor">
            <legend>Specifications</legend>
            {form.specs.map((row, index) => (
              <div className="spec-row" key={index}>
                <input aria-label={`Spec ${index + 1} name`} value={row.key} onChange={(e) => setSpec(index, { key: e.target.value })} placeholder="battery" />
                <input aria-label={`Spec ${index + 1} value`} value={row.value} onChange={(e) => setSpec(index, { value: e.target.value })} placeholder="7 days" />
                <button type="button" className="btn btn-quiet" onClick={() => removeSpec(index)} aria-label={`Remove spec row ${index + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={() => update({ specs: [...form.specs, { key: "", value: "" }] })}>
              Add spec
            </button>
          </fieldset>
        </>
      ) : (
        <div className="field">
          <label htmlFor={`${idPrefix}-raw`}>Details JSON</label>
          <textarea
            id={`${idPrefix}-raw`}
            className="mono"
            rows={10}
            spellCheck="false"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            aria-invalid={problems.length > 0}
          />
        </div>
      )}

      <p className={size > MAX_DETAILS_BYTES ? "field-error" : "field-hint"}>
        {size} / {MAX_DETAILS_BYTES} bytes
      </p>
      {problems.map((problem) => (
        <p className="field-error" key={problem}>
          {problem}
        </p>
      ))}
    </div>
  );
}
