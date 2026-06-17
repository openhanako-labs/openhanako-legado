// tools/legado_search_books.js
// 书源搜索。

import { readCredentials } from "./_lib/credentials.js";
import { searchBooks } from "./_lib/legado-api.js";

export default async function legado_search_books(
  { keyword, count = 20 } = {},
  { dataDir } = {}
) {
  if (!keyword) return { ok: false, code: "bad_payload", message: "keyword 不能为空" };

  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await searchBooks(serviceUrl, keyword, count);
    return { ok: true, books, totalCount: Array.isArray(books) ? books.length : 0 };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}