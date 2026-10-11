// App shell: header, the four tabs, and the shared activity feed.
// The current tab (and the listing being verified) live in the address bar, for example
// #/verify/3, so a verification can be shared as a link and the back button works.
import { useCallback, useEffect, useState } from "react";
import { ChainProvider } from "./context/ChainContext.jsx";
import { useChain } from "./context/chainState.js";
import { demoAccounts } from "./lib/config.js";
import { ActivityFeed } from "./components/ActivityFeed.jsx";
import { AccountBar } from "./components/AccountBar.jsx";
import { AdminView } from "./components/AdminView.jsx";
import { BrandView } from "./components/BrandView.jsx";
import { MarketplaceView } from "./components/MarketplaceView.jsx";
import { SetupScreen } from "./components/SetupScreen.jsx";
import { VerifyView } from "./components/VerifyView.jsx";
import { Empty, Icon, TxToast } from "./components/ui.jsx";

const TABS = [
  { id: "verify", label: "Verify" },
  { id: "marketplace", label: "Marketplace" },
  { id: "brand", label: "Brand" },
  { id: "admin", label: "Admin" },
];

/** Reads "#/tab/param" from the address bar and keeps it in sync. */
function useHashRoute() {
  const parse = () => {
    const [tab = "verify", param = null] = window.location.hash.replace(/^#\/?/, "").split("/");
    return { tab: TABS.some((t) => t.id === tab) ? tab : "verify", param: param || null };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((tab, param) => {
    window.location.hash = param ? `/${tab}/${param}` : `/${tab}`;
  }, []);
  return [route, go];
}

function Shell() {
  const { catalogError, deployment, lastTx, reportTx } = useChain();
  const [route, go] = useHashRoute();

  // Left/Right arrow keys move between tabs, as people expect from a tab list.
  function onTabKeyDown(event) {
    const index = TABS.findIndex((t) => t.id === route.tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length];
    go(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand-mark">
            <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="6" />
              <path d="M30 52l14 14 27-30" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="brand-name">VeriList</p>
              <p className="brand-tag">Registry of authentic product listings</p>
            </div>
          </div>
          <AccountBar />
        </div>
        <nav className="tabs" aria-label="Sections">
          <div role="tablist" onKeyDown={onTabKeyDown}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={route.tab === tab.id}
                aria-controls="main"
                tabIndex={route.tab === tab.id ? 0 : -1}
                onClick={() => go(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <div className="layout">
        <main id="main" role="tabpanel" aria-labelledby={`tab-${route.tab}`} tabIndex={-1}>
          {deployment.chainId === 31337 && !demoAccounts && (
            <p className="banner">
              <Icon name="warn" size={16} /> No demo data found. Run <code className="mono">npm run seed:local</code> to
              create the demo accounts, products and listings.
            </p>
          )}
          {catalogError && (
            <p className="banner banner-bad" role="alert">
              <Icon name="cross" size={16} /> Could not read the registry: {catalogError}
            </p>
          )}
          {route.tab === "verify" && <VerifyView listingId={route.param} onSelect={(id) => go("verify", id)} />}
          {route.tab === "marketplace" && <MarketplaceView />}
          {route.tab === "brand" && <BrandView />}
          {route.tab === "admin" && <AdminView />}
        </main>
        <ActivityFeed />
      </div>
      <TxToast tx={lastTx} onDismiss={() => reportTx(null)} />
    </>
  );
}

/** Chooses between the setup screen, a loading message, and the real app. */
function Gate() {
  const { phase } = useChain();
  if (phase === "loading") {
    return (
      <main className="setup" id="main">
        <Empty>Connecting to the registry…</Empty>
      </main>
    );
  }
  if (phase === "setup") return <SetupScreen />;
  return <Shell />;
}

export default function App() {
  return (
    <ChainProvider>
      <Gate />
    </ChainProvider>
  );
}
