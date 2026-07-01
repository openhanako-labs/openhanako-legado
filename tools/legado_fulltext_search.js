// tools/legado_fulltext_search.js
// 跨书全文搜索 — 在书架书籍的章节内容中搜索关键词。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getBookChapters, getChapterContent } from "./_lib/legado-api.js";

const MAX_BOOKS = 10;       // 最多搜 10 本书
const MAX_CHARS = 200;       // 上下文片段长度

export default async function legado_fulltext_search(
  { keyword, limit = 20, bookUrl = null } = {},
  { dataDir, log } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) return { ok: false, code: "no_service", message: "未配置服务地址" };
  if (!keyword) return { ok: false, code: "bad_payload", message: "关键词不能为空" };

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);
    if (books.length === 0) return { ok: true, results: [], total: 0 };

    // 确定搜索范围
    let searchBooks = bookUrl
      ? books.filter(b => b.bookUrl === bookUrl)
      : books.slice(0, MAX_BOOKS);

    const lowerKW = keyword.toLowerCase();
    const results = [];
    const seen = new Set();

    for (const book of searchBooks) {
      let chapters = [];
      try {
        chapters = await getBookChapters(serviceUrl, book.bookUrl);
      } catch { continue; }
      if (!Array.isArray(chapters) || chapters.length === 0) continue;

      // 限制每本搜的章节数（取前 50 章 + 最近读的章节附近）
      let searchIndices = chapters.map((_, i) => i);
      // 优先搜索最近阅读位置附近的章节
      const curIdx = book.durChapterIndex ?? -1;
      if (curIdx >= 0) {
        const nearby = [];
        for (let d = 0; d <= 20; d++) {
          if (curIdx - d >= 0) nearby.push(curIdx - d);
          if (d > 0 && curIdx + d < chapters.length) nearby.push(curIdx + d);
        }
        searchIndices = [...new Set([...nearby, ...searchIndices])].slice(0, 50);
      } else {
        searchIndices = searchIndices.slice(0, 30);
      }

      for (const idx of searchIndices) {
        if (results.length >= limit) break;
        const ch = chapters[idx];
        const chTitle = typeof ch === "string" ? ch : (ch.title || ch.name || `第${idx + 1}章`);

        // 先搜章节名（快路径）
        if (chTitle.toLowerCase().includes(lowerKW)) {
          const key = `${book.bookUrl}_${idx}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              bookTitle: book.name,
              bookUrl: book.bookUrl,
              chapterIndex: idx,
              chapterTitle: chTitle,
              matchType: "chapter_title",
              snippet: chTitle,
            });
          }
          continue;
        }

        // 搜章节正文
        let content = "";
        try { content = await getChapterContent(serviceUrl, book.bookUrl, idx); }
        catch { continue; }
        if (!content || typeof content !== "string") continue;

        const lowerContent = content.toLowerCase();
        const pos = lowerContent.indexOf(lowerKW);
        if (pos >= 0) {
          const key = `${book.bookUrl}_${idx}`;
          if (!seen.has(key)) {
            seen.add(key);
            const start = Math.max(0, pos - 60);
            const end = Math.min(content.length, pos + keyword.length + 60);
            let snippet = content.slice(start, end);
            if (start > 0) snippet = "..." + snippet;
            if (end < content.length) snippet = snippet + "...";
            results.push({
              bookTitle: book.name,
              bookUrl: book.bookUrl,
              chapterIndex: idx,
              chapterTitle: chTitle,
              matchType: "content",
              snippet,
              matchPos: pos,
            });
          }
        }
      }
      if (results.length >= limit) break;
    }

    return {
      ok: true,
      keyword,
      results: results.slice(0, limit),
      total: results.length,
      searchedBooks: searchBooks.length,
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}