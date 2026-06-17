// tools/legado_get_bookshelf.js
// 获取书架列表。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";

export default async function legado_get_bookshelf(
  { type = "0", count = 100 } = {},
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, type, count);
    return {
      ok: true,
      books,
      totalCount: books.length,
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}
