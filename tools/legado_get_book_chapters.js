// tools/legado_get_book_chapters.js
// 获取章节目录。

import { readCredentials } from "./_lib/credentials.js";
import { getBookChapters } from "./_lib/legado-api.js";

export default async function legado_get_book_chapters(
  { bookUrl } = {},
  { dataDir } = {}
) {
  if (!bookUrl) return { ok: false, code: "bad_payload", message: "bookUrl 不能为空" };

  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const chapters = await getBookChapters(serviceUrl, bookUrl);
    return { ok: true, chapters, totalCount: Array.isArray(chapters) ? chapters.length : 0 };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}