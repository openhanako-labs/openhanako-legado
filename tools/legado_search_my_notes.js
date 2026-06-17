// tools/legado_search_my_notes.js
// 搜索我的笔记——基于书架书籍元数据搜索。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";

export default async function legado_search_my_notes(
  { query, bookUrl = null, limit = 20 } = {},
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }
  if (!query) {
    return { ok: false, code: "bad_payload", message: "query 不能为空" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);

    // 过滤
    let filtered = books;
    if (bookUrl) {
      filtered = books.filter(b => b.bookUrl === bookUrl);
    }

    // 在书名、作者、简介中搜索关键词
    const lower = query.toLowerCase();
    const results = filtered
      .filter(b => {
        const name = (b.name || "").toLowerCase();
        const author = (b.author || "").toLowerCase();
        const intro = (b.intro || "").toLowerCase();
        const kind = (b.kind || "").toLowerCase();
        const chapterTitle = (b.durChapterTitle || "").toLowerCase();
        return name.includes(lower) || author.includes(lower) || intro.includes(lower)
          || kind.includes(lower) || chapterTitle.includes(lower);
      })
      .slice(0, limit)
      .map(b => ({
        bookUrl: b.bookUrl,
        bookTitle: b.name,
        bookAuthor: b.author,
        matchIn: [
          (b.name || "").toLowerCase().includes(lower) ? "书名" : null,
          (b.author || "").toLowerCase().includes(lower) ? "作者" : null,
          (b.intro || "").toLowerCase().includes(lower) ? "简介" : null,
          (b.durChapterTitle || "").toLowerCase().includes(lower) ? "当前章节" : null,
        ].filter(Boolean).join("、"),
        currentChapter: b.durChapterTitle || "",
        lastReadTime: b.durChapterTime ? new Date(b.durChapterTime).toISOString() : null,
        intro: (b.intro || "").slice(0, 200),
      }));

    return { ok: true, results, total: results.length };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}