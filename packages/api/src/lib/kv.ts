const TTL_FEED = 15 * 60;
const TTL_LOCATIONS = 60 * 60;
const TTL_CATEGORIES = 24 * 60 * 60;
const TTL_NEWS = 15 * 60;

export async function getCachedFeed(kv: KVNamespace, location_id: string, category: string): Promise<string | null> {
  return kv.get(`feed:${location_id}:${category}`);
}

export async function cacheFeed(kv: KVNamespace, location_id: string, category: string, data: string): Promise<void> {
  await kv.put(`feed:${location_id}:${category}`, data, { expirationTtl: TTL_FEED });
}

export async function getCachedNews(kv: KVNamespace, id: string): Promise<string | null> {
  return kv.get(`news:${id}`);
}

export async function cacheNews(kv: KVNamespace, id: string, data: string): Promise<void> {
  await kv.put(`news:${id}`, data, { expirationTtl: TTL_NEWS });
}

export async function getCachedLocations(kv: KVNamespace): Promise<string | null> {
  return kv.get("locations_tree");
}

export async function cacheLocations(kv: KVNamespace, data: string): Promise<void> {
  await kv.put("locations_tree", data, { expirationTtl: TTL_LOCATIONS });
}

export async function getCachedCategories(kv: KVNamespace): Promise<string | null> {
  return kv.get("categories_list");
}

export async function cacheCategories(kv: KVNamespace, data: string): Promise<void> {
  await kv.put("categories_list", data, { expirationTtl: TTL_CATEGORIES });
}

export async function invalidateFeedCache(kv: KVNamespace, location_id?: string): Promise<void> {
  if (location_id) {
    const categories = ["politica", "economia", "deportes", "sociedad", "policiales", "cultura", "tecnologia", "internacional", ""];
    for (const cat of categories) await kv.delete(`feed:${location_id}:${cat}`);
  }
}
