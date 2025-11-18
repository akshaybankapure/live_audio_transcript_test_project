import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Render immediately without waiting
const root = document.getElementById("root")!;
createRoot(root).render(<App />);
