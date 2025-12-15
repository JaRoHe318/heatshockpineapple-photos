// astro.config.mjs

import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  // This is CRITICAL for the sitemap to work
  site: "https://photos.heatshockpineapple.com", 
  
  integrations: [sitemap()]
});