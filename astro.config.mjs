import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import rehypeSanitize from "rehype-sanitize";
import { unified } from "@astrojs/markdown-remark";
import { siteConfig } from "./src/config/site.ts";

export default defineConfig({
  site: siteConfig.url,
  output: "static",
  trailingSlash: "always",
  integrations: [sitemap()],
  markdown: { processor: unified({ rehypePlugins: [rehypeSanitize] }) },
});
