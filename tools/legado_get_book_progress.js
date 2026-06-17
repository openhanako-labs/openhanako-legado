// tools/legado_get_book_progress.js
// 获取阅读进度。

import { readCredentials } from "./_lib/credentials.js";
import { getBookProgress } from "./_lib/legado-api.js";

export default async function legado_get_book_progress(
  { bookUrl } = {},
  { dataDir } = {}
) {
  if (!bookUrl) return { ok: false, code: "bad_payload", message: "bookUrl 不能为空" };

  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const result = await getBookProgress(serviceUrl, bookUrl);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}