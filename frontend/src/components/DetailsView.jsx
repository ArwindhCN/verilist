// Shows a product's details JSON as readable fields, and its version history.
import { formatInr, formatTimestamp } from "../lib/format.js";
import { parseDetailsForDisplay } from "../lib/details.js";
import { Hash, Icon } from "./ui.jsx";

const LABELS = { model: "Model", category: "Category", mrp: "MRP", warranty: "Warranty" };
const prettify = (key) => key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, " ");
const asText = (value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/** Readable fields for one details JSON string. Falls back to the raw text if it is not a JSON object. */
export function DetailsView({ details }) {
  const parsed = parseDetailsForDisplay(details);
  if (!parsed) return <pre className="raw">{details}</pre>;

  const { model, category, specs, mrp, warranty, ...rest } = parsed;
  const specsAreObject = specs && typeof specs === "object" && !Array.isArray(specs);
  const rows = [];
  if (model !== undefined) rows.push([LABELS.model, asText(model)]);
  if (category !== undefined) rows.push([LABELS.category, asText(category)]);
  if (mrp !== undefined) rows.push([LABELS.mrp, typeof mrp === "number" ? formatInr(mrp) : asText(mrp)]);
  if (warranty !== undefined) rows.push([LABELS.warranty, asText(warranty)]);
  if (specs !== undefined && !specsAreObject) rows.push(["Specs", asText(specs)]);
  for (const [key, value] of Object.entries(rest)) rows.push([prettify(key), asText(value)]);

  return (
    <div className="details">
      <dl className="fields">
        {rows.map(([label, value]) => (
          <div className="field-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {specsAreObject && Object.keys(specs).length > 0 && (
        <>
          <h4 className="subhead">Specifications</h4>
          <dl className="fields specs">
            {Object.entries(specs).map(([key, value]) => (
              <div className="field-row" key={key}>
                <dt>{prettify(key)}</dt>
                <dd>{asText(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

/** Expandable list of every saved version, newest first, each with its timestamp and hash check. */
export function VersionHistory({ versions }) {
  if (!versions || versions.length === 0) return null;
  const newestFirst = [...versions].reverse();
  return (
    <details className="history">
      <summary>
        Version history ({versions.length} {versions.length === 1 ? "version" : "versions"})
      </summary>
      <ol className="history-list" reversed>
        {newestFirst.map((version) => (
          <li key={version.number} value={version.number}>
            <div className="history-head">
              <strong>Version {version.number}</strong>
              <span className="muted">{formatTimestamp(version.timestamp)}</span>
              <span className={version.hashMatches ? "integrity ok" : "integrity bad"}>
                <Icon name={version.hashMatches ? "check" : "cross"} size={13} />
                {version.hashMatches ? "hash matches" : "HASH MISMATCH"}
              </span>
            </div>
            <div className="history-hash">
              <span className="muted">Hash</span> <Hash value={version.detailsHash} />
            </div>
            <details className="history-details">
              <summary>Show this version's details</summary>
              <DetailsView details={version.details} />
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
