import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Auf GitHub Pages liegt die App unter einem Unterpfad. Absolute Pfade in der
// CSS-Datei zeigen sonst ins Leere.
document.documentElement.style.setProperty(
  "--logo",
  `url("${import.meta.env.BASE_URL}logo.png") center / contain no-repeat`,
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
