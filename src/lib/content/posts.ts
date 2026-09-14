import { getCollection } from "astro:content";
import { isPublished } from "./schema";
import { siteConfig } from "../../config/site";
export async function publishedPosts() {
  return (await getCollection("posts"))
    .filter((post) => isPublished(post.data))
    .sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt));
}
export function displayDate(date: string) {
  return new Intl.DateTimeFormat(siteConfig.locale, {
    dateStyle: "long",
    timeZone: "Europe/Berlin",
  }).format(new Date(date));
}
