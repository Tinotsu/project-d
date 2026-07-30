import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "../styles/index.css";

createRoot(document.querySelector("#root")!).render(
  <App />,
);
