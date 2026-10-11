// Product details are stored on chain as a JSON string. These helpers convert between that string
// and the structured form fields (model, category, spec rows, MRP, warranty) used by the Brand view.
import { byteLength } from "./format.js";

export const MAX_DETAILS_BYTES = 4096;
export const MAX_NAME_BYTES = 100;
export const MAX_SKU_BYTES = 64;

export const emptyForm = () => ({
  model: "",
  category: "",
  specs: [{ key: "", value: "" }],
  mrp: "",
  warranty: "",
  extra: {}, // any other top-level fields found in existing details, kept so editing never drops them
});

/** Structured form -> plain object, leaving out anything that was left blank. */
export function buildDetailsObject(form) {
  const out = {};
  if (form.model.trim()) out.model = form.model.trim();
  if (form.category.trim()) out.category = form.category.trim();

  const specs = {};
  for (const row of form.specs) {
    if (row.key.trim()) specs[row.key.trim()] = row.value.trim();
  }
  if (Object.keys(specs).length > 0) out.specs = specs;

  if (String(form.mrp).trim() !== "") out.mrp = Number(form.mrp);
  if (form.warranty.trim()) out.warranty = form.warranty.trim();

  return { ...out, ...form.extra };
}

/** Structured form -> the exact JSON string that will be stored on chain (compact, stable key order). */
export const buildDetailsJson = (form) => JSON.stringify(buildDetailsObject(form));

/** Problems with the structured form, as a list of plain sentences (empty list = fine). */
export function validateForm(form) {
  const problems = [];
  if (String(form.mrp).trim() !== "") {
    const mrp = Number(form.mrp);
    if (!Number.isFinite(mrp) || mrp < 0) problems.push("MRP must be a number that is zero or more.");
  }
  const keys = form.specs.map((r) => r.key.trim()).filter(Boolean);
  if (new Set(keys).size !== keys.length) problems.push("Two spec rows have the same name.");
  const obj = buildDetailsObject(form);
  if (Object.keys(obj).length === 0) problems.push("Fill in at least one detail.");
  const size = byteLength(JSON.stringify(obj));
  if (size > MAX_DETAILS_BYTES) problems.push(`Details are ${size} bytes; the limit is ${MAX_DETAILS_BYTES}.`);
  return problems;
}

/** Checks a raw JSON text. Details must be a JSON object and fit in the on-chain size limit. */
export function validateRawJson(text) {
  if (text.trim() === "") return { ok: false, error: "Details cannot be empty." };
  const size = byteLength(text);
  if (size > MAX_DETAILS_BYTES) return { ok: false, error: `Details are ${size} bytes; the limit is ${MAX_DETAILS_BYTES}.` };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `This is not valid JSON: ${error.message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Details must be a JSON object, like { \"model\": \"...\" }." };
  }
  return { ok: true, parsed, size };
}

/** JSON string -> structured form. `ok` is false if the text is not an object the form can show. */
export function formFromJson(text) {
  const checked = validateRawJson(text);
  if (!checked.ok) return { ok: false, error: checked.error, form: emptyForm() };
  const obj = checked.parsed;

  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isString = (v) => typeof v === "string";
  // A known field only goes into its form input when its value has the expected type.
  // Everything else (unknown fields, or known fields with a surprising type) is kept in `extra`
  // and written back unchanged, so editing through the form never silently drops data.
  const fits = { model: isString, category: isString, specs: isPlainObject, mrp: (v) => typeof v === "number", warranty: isString };
  const extra = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!(key in fits) || !fits[key](value)) extra[key] = value;
  }
  const specRows = isPlainObject(obj.specs)
    ? Object.entries(obj.specs).map(([key, value]) => ({ key, value: String(value) }))
    : [];

  return {
    ok: true,
    form: {
      model: fits.model(obj.model) ? obj.model : "",
      category: fits.category(obj.category) ? obj.category : "",
      specs: specRows.length > 0 ? specRows : [{ key: "", value: "" }],
      mrp: fits.mrp(obj.mrp) ? String(obj.mrp) : "",
      warranty: fits.warranty(obj.warranty) ? obj.warranty : "",
      extra,
    },
  };
}

/** Parses stored details for display. Returns null if they are not a JSON object. */
export function parseDetailsForDisplay(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
