import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { loadFaceDetector } from "./pipeline/faceDetector";
import { App } from "./ui/App";

// Start downloading the face detector (wasm + model) right away, in parallel with waking the
// backend, so Start is instant. A failure here is retried and reported by the live screen.
loadFaceDetector().catch(() => {});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
