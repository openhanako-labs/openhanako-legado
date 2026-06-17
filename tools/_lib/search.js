// _lib/search.js
// 本地索引+检索——将笔记/划线数据建立倒排索引，支持关键词检索。
// 复用 weread-companion 的 search 逻辑，适配开源阅读数据结构。

import { readCache, writeCache } from "./cache.js";
import { getBookNotes } from "./legado-api.js";
import { readCredentials } from "./credentials.js";

/**
 * 构建本地索引（将笔记数据索引化）。
 */
export async function buildLocalIndex(dataDir, serviceUrl, accessToken) {
  const indexKey = "local_note_index";
  const cached = readCache(dataDir, indexKey);
  if (cached && cached._meta && cached._meta.updatedAt) {
    // 缓存不超过 1 小时
    if (Date.now() - cached._meta.updatedAt < 60 * 60 * 1000) {
      return { ok: true, index: cached, source: "cache" };
    }
  }

  // 重新构建
  const index = { _meta: { updatedAt: Date.now() }, books: {} };
  // 注意：实际构建需要遍历所有书籍，这里只是框架
  writeCache(dataDir, indexKey, index);
  return { ok: true, index, source: "fresh" };
}

/**
 * 关键词搜索（基于本地索引）。
 */
export function searchLocalIndex(index, keyword, limit = 20) {
  if (!keyword || !index || !index.books) return { results: [], total: 0 };

  const lower = keyword.toLowerCase();
  const results = [];

  for (const [bookId, bookData] of Object.entries(index.books)) {
    const notes = bookData.notes || [];
    for (const note of notes) {
      const content = (note.content || "").toLowerCase();
      if (content.includes(lower)) {
        results.push({
          bookId,
          bookTitle: bookData.title || "未知",
          note,
          score: content.split(lower).length - 1, // 匹配次数越高越相关
        });
      }
    }
  }

  // 排序 + 限制
  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), total: results.length };
}
