import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./app.css";

createRoot(document.querySelector("#root")!).render(
  <App />,
);
