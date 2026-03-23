import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	outDir: "dist",
	platform: "node",
	banner: { js: "#!/usr/bin/env node" },
});
