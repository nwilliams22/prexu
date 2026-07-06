import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./services/query-client";
import { initializeCacheInvalidators } from "./services/cache-invalidators";
import "./styles.css";

// Initialize module-level cache invalidation listeners that persist across
// component mount/unmount cycles, ensuring dashboard cache stays fresh even
// when the Dashboard is unmounted (e.g., while the Player overlay is active).
initializeCacheInvalidators();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
