// Shown instead of the app whenever something must be fixed first (no deployment, node not running,
// wrong network, ...). It always says what is wrong and gives the exact commands to run.
import { useState } from "react";
import { useChain } from "../context/chainState.js";
import { LOCAL_CHAIN_ID, LOCAL_RPC_URL } from "../lib/config.js";
import { CopyButton, Icon } from "./ui.jsx";

/** A shell command with a copy button. */
function Command({ children }) {
  return (
    <div className="cmd">
      <code className="mono">{children}</code>
      <CopyButton text={children} label="Copy command" />
    </div>
  );
}

const THREE_TERMINALS = (
  <ol className="steps">
    <li>
      <p>In a first terminal, start the local blockchain and leave it running:</p>
      <Command>npm run node</Command>
    </li>
    <li>
      <p>In a second terminal, deploy the contracts and add the demo data:</p>
      <Command>npm run deploy:local && npm run seed:local</Command>
    </li>
    <li>
      <p>Then reload this page (the frontend itself runs with):</p>
      <Command>npm run frontend:dev</Command>
    </li>
  </ol>
);

export function SetupScreen() {
  const { setup, retry, deployment, switchNetwork, mode, switchMode, canSwitchMode } = useChain();
  const [switchError, setSwitchError] = useState(null);

  async function trySwitch() {
    setSwitchError(null);
    try {
      await switchNetwork();
    } catch (error) {
      setSwitchError(
        error?.code === 4902
          ? "Your wallet does not know this network yet. Add it in your wallet's network settings, then try again."
          : "The network switch was not completed."
      );
    }
  }

  let title;
  let body;
  switch (setup.kind) {
    case "no-deployment":
      title = "VeriList is not deployed yet";
      body = (
        <>
          <p>
            The app could not find <code className="mono">frontend/src/contracts/deployment.json</code>. That file is
            written when the contracts are deployed. Run these commands from the project folder:
          </p>
          {THREE_TERMINALS}
        </>
      );
      break;
    case "node-down":
      title = "Cannot reach the local blockchain";
      body = (
        <>
          <p>
            Nothing is answering at <code className="mono">{LOCAL_RPC_URL}</code>. Start the local node in a separate
            terminal and keep it running:
          </p>
          <Command>npm run node</Command>
          <p>If you started a fresh node, the contracts need deploying again:</p>
          <Command>npm run deploy:local && npm run seed:local</Command>
        </>
      );
      break;
    case "wrong-chain":
      title = "The node is on a different chain";
      body = (
        <>
          <p>
            The node at <code className="mono">{LOCAL_RPC_URL}</code> reports chain id {setup.actual}, but this app was
            deployed to chain id {deployment.chainId}. Deploy again against the node you are running:
          </p>
          <Command>npm run deploy:local && npm run seed:local</Command>
        </>
      );
      break;
    case "not-deployed":
      title = "The contracts are no longer on this chain";
      body = (
        <>
          <p>
            The chain is reachable, but nothing is deployed at the address saved in{" "}
            <code className="mono">deployment.json</code>. This usually means the node was restarted (a local node
            forgets everything when it stops). Deploy and seed again:
          </p>
          <Command>npm run deploy:local && npm run seed:local</Command>
          <p>Then press “Check again”.</p>
        </>
      );
      break;
    case "no-wallet":
      title = "No wallet found";
      body = (
        <>
          <p>
            This deployment ({deployment.network}, chain id {deployment.chainId}) is used through a browser wallet such
            as MetaMask, and none was detected. Install MetaMask, then reload.
          </p>
          {deployment.chainId === LOCAL_CHAIN_ID && canSwitchMode === false && (
            <p>
              Or use the built-in demo accounts instead.{" "}
              <button type="button" className="btn btn-secondary" onClick={() => switchMode("demo")}>
                Use demo accounts
              </button>
            </p>
          )}
        </>
      );
      break;
    case "wrong-network":
      title = "Your wallet is on the wrong network";
      body = (
        <>
          <p>
            Your wallet is on chain id {setup.actual}. This deployment is on <strong>{deployment.network}</strong>{" "}
            (chain id {deployment.chainId}).
          </p>
          <p>
            <button type="button" className="btn btn-primary" onClick={trySwitch}>
              Switch network in wallet
            </button>
          </p>
          {switchError && <p className="field-error">{switchError}</p>}
        </>
      );
      break;
    default:
      title = "Something went wrong while connecting";
      body = <p>{setup.message}</p>;
  }

  return (
    <main className="setup" id="main">
      <div className="setup-mark" aria-hidden="true">
        <Icon name="warn" size={28} />
      </div>
      <h1>{title}</h1>
      {body}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (setup.kind === "no-deployment" ? window.location.reload() : retry())}
        >
          Check again
        </button>
        {mode === "metamask" && deployment?.chainId === LOCAL_CHAIN_ID && (
          <button type="button" className="btn btn-secondary" onClick={() => switchMode("demo")}>
            Use demo accounts instead
          </button>
        )}
      </div>
    </main>
  );
}
