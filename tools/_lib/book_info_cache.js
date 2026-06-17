// _lib/book_info_cache.js
// 书籍信息缓存——7 天 TTL，miss 时调 API 写入缓存。

import { readCache, writeCache } from "./cache.js";
import { getBookInfo } from "./legado-api.js";

/**
 * 获取书籍信息（缓存优先）。
 * @param {string} dataDir
 * @param {string} serviceUrl
 * @param {string} bookUrl
 * @param {boolean} [forceRefresh]
 */
export async function getBookInfoCached(dataDir, serviceUrl, bookUrl, forceRefresh = false) {
  const cacheKey = `book_info_${Buffer.from(bookUrl).toString("base64").slice(0, 32)}`;

  if (!forceRefresh) {
    const cached = readCache(dataDir, cacheKey);
    if (cached) return { ok: true, source: "cache", data: cached };
  }

  try {
    const result = await getBookInfo(serviceUrl, bookUrl);
    if (result) {
      writeCache(dataDir, cacheKey, result);
      return { ok: true, source: "fresh", data: result };
    }
  } catch (err) {
    const cached = readCache(dataDir, cacheKey);
    if (cached) return { ok: true, source: "stale_cache", error: err.message, data: cached };
    return { ok: false, code: err.code, message: err.message };
  }
}