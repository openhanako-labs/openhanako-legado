// _lib/search_books.js
// 综合检索框架——将书源搜索结果索引化，支持关键词搜索书籍。
// 复用 weread-companion 的 search_books 逻辑。

import { readCache, writeCache } from "./cache.js";

/**
 * 将搜索结果索引化。
 */
export async function indexSearchResults(keyword, books, dataDir) {
  const cacheKey = `search_${keyword.replace(/\s+/g, "_")}`;
  writeCache(dataDir, cacheKey, {
    keyword,
    books,
    timestamp: Date.now(),
  });
  return { ok: true, cacheKey, count: books.length };
}

/**
 * 从缓存读取搜索结果。
 */
export function getCachedSearchResults(dataDir, cacheKey) {
  return readCache(dataDir, cacheKey);
}
