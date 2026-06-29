// tools/legado_search_my_notes.js
// 搜索我的笔记/划线——基于 Legado 真实书签数据搜索。
// 不再搜索书籍元数据，而是搜索笔记内容本身。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getBookNotes, getAllBookNotes } from "./_lib/legado-api.js";

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
    const lower = query.toLowerCase();
    let notes = [];

    if (bookUrl) {
      // 搜索某本书的笔记
      notes = await getBookNotes(serviceUrl, bookUrl);
    } else {
      // 遍历书架搜索所有笔记
      const books = await getBookshelf(serviceUrl, "0", 100);
      // 先快速在书名中匹配，缩小范围
      const matchedBooks = books.filter(b =>
        (b.name || "").toLowerCase().includes(lower) ||
        (b.author || "").toLowerCase().includes(lower)
      );
      // 匹配到的书拿真实笔记，未匹配的书也查一下（笔记内容可能匹配）
      const allNotes = await getAllBookNotes(serviceUrl, books, 3);
      notes = allNotes;
    }

    // 在笔记内容中搜索
    const results = notes
      .filter(n => {
        const content = (n.content || "").toLowerCase();
        const chapter = (n.chapterName || "").toLowerCase();
        const bookName = (n.bookName || "").toLowerCase();
        return content.includes(lower) || chapter.includes(lower) || bookName.includes(lower);
      })
      .slice(0, limit)
      .map(n => ({
        noteId: `${n.bookId}_${n.chapterPos}_${n.createTime}`,
        bookTitle: n.bookName || "",
        chapterName: n.chapterName || "",
        content: (n.content || "").slice(0, 500),
        type: n.type || "bookmark",
        color: n.color || "",
        createTime: n.createTime || 0,
        matchIn: [
          (n.content || "").toLowerCase().includes(lower) ? "笔记内容" : null,
          (n.chapterName || "").toLowerCase().includes(lower) ? "章节名" : null,
          (n.bookName || "").toLowerCase().includes(lower) ? "书名" : null,
        ].filter(Boolean).join("、"),
      }));

    return { ok: true, results, total: results.length };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}