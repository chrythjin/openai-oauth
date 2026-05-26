import { useState } from "react"
import TokensTab from "./components/TokensTab"
import UsageTab from "./components/UsageTab"
import "./styles/dashboard.css"

export default function App() {
	const [tab, setTab] = useState<"usage" | "tokens">("usage")

	return (
		<div className="app">
			<nav className="tab-bar">
				<button
					type="button"
					className={`tab-btn${tab === "usage" ? " active" : ""}`}
					onClick={() => setTab("usage")}
				>
					Usage
				</button>
				<button
					type="button"
					className={`tab-btn${tab === "tokens" ? " active" : ""}`}
					onClick={() => setTab("tokens")}
				>
					Tokens
				</button>
			</nav>
			{tab === "usage" ? <UsageTab /> : <TokensTab />}
		</div>
	)
}
