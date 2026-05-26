import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

const proxyTarget =
	process.env.VITE_DASHBOARD_PROXY_TARGET ?? "http://127.0.0.1:10531"

export default defineConfig({
	plugins: [react()],
	root: ".",
	base: "/dashboard/",
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: path.resolve(__dirname, "index.html"),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/api": {
				target: proxyTarget,
				changeOrigin: true,
			},
		},
	},
})
