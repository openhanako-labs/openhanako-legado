// tools/legado_get_book_notes.js
// 获取笔记/划线/书签——从 Legado 真实书签 API 读取。
// 不再用阅读进度冒充笔记。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getBookNotes, getAllBookNotes } from "./_lib/legado-api.js";

export default async function legado_get_book_notes(
  { bookUrl, limit = 50 } = {},
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    // 如果指定了 bookUrl，只查单本书的笔记
    if (bookUrl) {
      const notes = await getBookNotes(serviceUrl, bookUrl);
      return {
        ok: true,
        notes: notes.slice(0, limit),
        totalCount: notes.length,
      };
    }

    // 无 bookUrl：遍历书架所有书，收集笔记
    const books = await getBookshelf(serviceUrl, "0", 100);
    const allNotes = await getAllBookNotes(serviceUrl, books, 3);

    // 按时间倒序排列
    allNotes.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));

    return {
      ok: true,
      notes: allNotes.slice(0, limit),
      totalCount: allNotes.length,
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}