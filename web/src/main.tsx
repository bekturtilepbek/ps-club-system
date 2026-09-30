import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/golos-text/cyrillic-500.css";
import "@fontsource/golos-text/latin-500.css";
import "@fontsource/golos-text/cyrillic-600.css";
import "@fontsource/golos-text/latin-600.css";
import "@fontsource/golos-text/cyrillic-700.css";
import "@fontsource/golos-text/latin-700.css";
import "@fontsource/unbounded/cyrillic-600.css";
import "@fontsource/unbounded/latin-600.css";
import "@fontsource/unbounded/cyrillic-700.css";
import "@fontsource/unbounded/latin-700.css";
import "@fontsource/unbounded/cyrillic-800.css";
import "@fontsource/unbounded/latin-800.css";
import "@fontsource/jetbrains-mono/cyrillic-500.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-800.css";
import "@fontsource/jetbrains-mono/latin-800.css";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
