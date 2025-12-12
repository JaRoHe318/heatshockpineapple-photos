import { defineConfig } from "astro/config";

import sitemap from "@astrojs/sitemap";

export default defineConfig({
  // IMPORTANT: no `base: '/code'` here.
  // If you see a base property, delete it or set it to '/'.
  site: "https://photos.heatshockpineapple.com",

  integrations: [sitemap()]
});