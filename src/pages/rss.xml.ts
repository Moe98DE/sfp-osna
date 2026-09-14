import rss from "@astrojs/rss";
import { publishedPosts } from "../lib/content/posts";
import { siteConfig } from "../config/site";
export async function GET() {
  return rss({
    title: siteConfig.name,
    description: siteConfig.description,
    site: siteConfig.url,
    items: (await publishedPosts()).map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      pubDate: new Date(post.data.publishedAt),
      link: `/posts/${post.id}/`,
    })),
    customData: `<language>${siteConfig.language}</language>`,
  });
}
