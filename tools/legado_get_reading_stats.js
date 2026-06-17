// tools/legado_get_reading_stats.js
// 阅读统计——基于书架数据生成。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";

export default async function legado_get_reading_stats(
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);

    const totalBooks = books.length;
    const readBooks = books.filter(b => (b.durChapterIndex ?? -1) >= 0).length;
    const inProgress = books.filter(b => b.durChapterTitle && b.durChapterTitle.length > 0).length;
    const finished = books.filter(b => (b.wordCount || "").includes("完结") || (b.kind || "").includes("完结")).length;
    const localBooks = books.filter(b => b.origin === "loc_book").length;
    const onlineBooks = totalBooks - localBooks;

    const groups = {};
    for (const b of books) {
      const g = b.group ?? 0;
      groups[g] = (groups[g] || 0) + 1;
    }

    return {
      ok: true,
      stats: {
        totalBooks,
        readBooks,
        inProgress,
        finished,
        localBooks,
        onlineBooks,
        groups: Object.keys(groups).map(k => ({ groupId: Number(k), count: groups[k] })),
      },
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}