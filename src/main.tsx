import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { readProbeBootstrap } from "./services/probe-bootstrap";
import { logger } from "./services/logger";
import { queryClient } from "./services/query-client";
import { initializeCacheInvalidators } from "./services/cache-invalidators";
import "./styles.css";

// Initialize module-level cache invalidation listeners that persist across
// component mount/unmount cycles, ensuring dashboard cache stays fresh even
// when the Dashboard is unmounted (e.g., while the Player overlay is active).
initializeCacheInvalidators();

async function start() {
  const probeAuth = await readProbeBootstrap();
  const router = createBrowserRouter([{ path: "*", element: <App probeAuth={probeAuth} /> }]);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

void start().catch(() => {
  logger.error("probe", "probe_bootstrap_failed");
});
