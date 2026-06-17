// tools/legado_get_book_notes.js
// 获取笔记/书签——从书架书籍中提取。
// 开源阅读的笔记管理较为复杂，此工具先基于书籍进度和最近阅读状态提供笔记线索。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";

export default async function legado_get_book_notes(
  { bookUrl, limit = 20 } = {},
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);
    
    // 如果指定了 bookUrl，只返回该书的笔记
    let filteredBooks = books;
    if (bookUrl) {
      filteredBooks = books.filter(b => b.bookUrl === bookUrl);
    }

    // 将书籍进度和最近阅读状态作为笔记信息返回
    const notes = filteredBooks.slice(0, limit).map(b => ({
      bookId: b.bookUrl,
      bookTitle: b.name,
      bookAuthor: b.author,
      coverUrl: b.customCoverUrl || b.coverUrl,
      currentChapter: b.durChapterTitle || "",
      currentChapterIndex: b.durChapterIndex ?? -1,
      readPosition: b.durChapterPos ?? 0,
      lastReadTime: b.durChapterTime ? new Date(b.durChapterTime).toISOString() : null,
      totalChapters: b.totalChapterNum ?? 0,
      intro: b.intro || "",
      wordCount: b.wordCount || "",
    }));

    return { ok: true, notes, totalCount: notes.length };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}