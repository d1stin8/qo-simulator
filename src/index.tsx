// src/index.tsx
import { render } from "solid-js/web";
import App from "./App";
import { LabProvider } from "./store/LabStore";
import "./index.css";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found.");
}

render(
  () => (
    <LabProvider>
      <App />
    </LabProvider>
  ),
  root!
);
