import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { articleSchema } from "./lib/content/schema";

export const collections = {
  posts: defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
    schema: articleSchema,
  }),
};
