// "Name this address": gives a seller (or any address) a friendly name from inside the website.
// The name is kept in this browser only. Nothing is written to the blockchain.
import { useState } from "react";
import { useChain } from "../context/chainState.js";
import { MAX_NAME_LENGTH } from "../lib/addressNames.js";

/** Render with `key={address}` so a half-typed name never carries over to a different address. */
export function NicknameEditor({ id, address }) {
  const { savedNames, labelFor, saveName } = useChain();
  const saved = savedNames.find((entry) => entry.address.toLowerCase() === address.toLowerCase());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Already named by the blockchain (brand, marketplace, admin), the demo accounts, or address-names.json.
  if (!saved && labelFor(address)) return null;

  if (saved && !editing) {
    return (
      <p className="nickname-saved">
        Saved name: <strong>{saved.name}</strong>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            setDraft(saved.name);
            setEditing(true);
          }}
        >
          Rename
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => saveName(address, "")}>
          Forget
        </button>
      </p>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    saveName(address, draft);
    setEditing(false);
  };

  return (
    <form className="nickname-form" onSubmit={submit}>
      <label htmlFor={id}>Name this address</label>
      <div className="nickname-row">
        <input
          id={id}
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. FakeDeals"
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={!draft.trim()}>
          {saved ? "Update name" : "Save name"}
        </button>
        {saved && (
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
      <p className="field-hint">Saved only in this browser, so you can pick it by name next time. Nothing goes on the blockchain.</p>
    </form>
  );
}
