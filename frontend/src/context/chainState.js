// The shared chain context object and its hook live in their own file (not next to the provider
// component), so hot-reloading the provider during development never creates a second, empty context.
import { createContext, useContext } from "react";

export const ChainContext = createContext(null);

/** Access to the shared chain state. Must be used inside <ChainProvider>. */
export const useChain = () => useContext(ChainContext);
