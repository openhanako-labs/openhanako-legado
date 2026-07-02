// tools/legado_fulltext_search.js
// 全文搜索 — 在指定书籍的章节内容中搜索关键词。

import { readCredentials } from "./_lib/credentials.js";
import { getBookChapters, getChapterContent } from "./_lib/legado-api.js";

const MAX_CHARS = 200;

export default async function legado_fulltext_search(
  { keyword, limit = 20, bookUrl = null } = {},
  { dataDir, log } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) return { ok: false, code: "no_service", message: "未配置服务地址" };
  if (!keyword) return { ok: false, code: "bad_payload", message: "关键词不能为空" };
  if (!bookUrl) return { ok: false, code: "bad_payload", message: "请先选择一本书" };

  try {
    let chapters = [];
    try {
      chapters = await getBookChapters(serviceUrl, bookUrl);
    } catch {
      return { ok: false, code: "chapters_failed", message: "获取章节列表失败" };
    }
    if (!Array.isArray(chapters) || chapters.length === 0) {
      return { ok: true, results: [], total: 0, hint: "该书籍无章节" };
    }

    const lowerKW = keyword.toLowerCase();
    const results = [];

    for (let idx = 0; idx < chapters.length; idx++) {
      if (results.length >= limit) break;
      const ch = chapters[idx];
      const chTitle = typeof ch === "string" ? ch : (ch.title || ch.name || `第${idx + 1}章`);

      // 先搜章节名
      if (chTitle.toLowerCase().includes(lowerKW)) {
        results.push({
          bookUrl,
          chapterIndex: idx,
          chapterTitle: chTitle,
          matchType: "chapter_title",
          snippet: chTitle,
        });
        continue;
      }

      // 搜章节正文
      let content = "";
      try { content = await getChapterContent(serviceUrl, bookUrl, idx); }
      catch { continue; }
      if (!content || typeof content !== "string") continue;

      const pos = content.toLowerCase().indexOf(lowerKW);
      if (pos >= 0) {
        const start = Math.max(0, pos - 60);
        const end = Math.min(content.length, pos + keyword.length + 60);
        let snippet = content.slice(start, end);
        if (start > 0) snippet = "..." + snippet;
        if (end < content.length) snippet = snippet + "...";
        results.push({
          bookUrl,
          chapterIndex: idx,
          chapterTitle: chTitle,
          matchType: "content",
          snippet,
        });
      }
    }

    return {
      ok: true,
      keyword,
      bookUrl,
      results: results.slice(0, limit),
      total: results.length,
      searchedChapters: chapters.length,
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}