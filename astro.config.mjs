// astro.config.mjs

import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import imageAliases from "./scripts/photo-manager/image-aliases.mjs";

export default defineConfig({
  redirects: { "/gallery/Cities/Guatemala": "/gallery/Cities/Antigua" },
  // This is CRITICAL for the sitemap to work
  site: "https://photos.heatshockpineapple.com", 
  
  integrations: [sitemap(), imageAliases()]
});