import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminProvider } from "./store";
import { AdminApp } from "./AdminApp";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminProvider>
      <AdminApp />
    </AdminProvider>
  </StrictMode>,
);
