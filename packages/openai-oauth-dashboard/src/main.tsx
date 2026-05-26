import { createRoot } from "react-dom/client"
import App from "./App"

const root = document.getElementById("root")
if (root) {
	root.style.backgroundColor = "var(--bg)"
	createRoot(root).render(<App />)
}
