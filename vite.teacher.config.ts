import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
	plugins: [
		react(),
		{
			name: "add-resource-hints",
			transformIndexHtml(html) {
				return html.replace(
					"<head>",
					`<head>
    <!-- Resource hints for critical resources (teacher) -->
    <link rel="preconnect" href="/" crossorigin>
    <link rel="dns-prefetch" href="/">`
				);
			},
		},
	],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "teacher-client", "src"),
			"@shared": path.resolve(import.meta.dirname, "shared"),
			"@assets": path.resolve(import.meta.dirname, "attached_assets"),
		},
	},
	root: path.resolve(import.meta.dirname, "teacher-client"),
	build: {
		outDir: path.resolve(import.meta.dirname, "dist/teacher-public"),
		emptyOutDir: false,
		rollupOptions: {
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"router-vendor": ["wouter"],
					"query-vendor": ["@tanstack/react-query"],
					"ui-vendor": ["lucide-react"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
	server: {
		port: 5174,
		fs: {
			strict: true,
			deny: ["**/.*"],
		},
	},
	optimizeDeps: {
		include: ["react", "react-dom", "wouter", "@tanstack/react-query"],
	},
});



