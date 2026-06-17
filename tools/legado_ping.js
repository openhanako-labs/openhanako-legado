// tools/legado_ping.js
// 连接检测——验证服务地址是否可达。

import { readCredentials } from "./_lib/credentials.js";
import { ping, ConnectionError, TimeoutError } from "./_lib/legado-api.js";

export default async function legado_ping({ limit = 5 } = {}, { dataDir } = {}) {
  let creds;
  if (dataDir) {
    creds = readCredentials(dataDir);
  } else {
    creds = readCredentials(null);
  }

  const { serviceUrl } = creds;
  if (!serviceUrl) {
    return {
      ok: false,
      code: "no_service",
      message: "未配置开源阅读服务地址",
      hint: "请在阅读插件的设置中配置服务地址（如 http://192.168.1.84:1122）",
    };
  }

  try {
    const books = await ping(serviceUrl);
    return {
      ok: true,
      code: "connected",
      serviceUrl,
      bookCount: books.length,
      books: books.slice(0, limit),
    };
  } catch (err) {
    return {
      ok: false,
      code: err.code || "unknown",
      serviceUrl,
      message: err.message,
      hint: err.code === "connection"
        ? "请检查手机和电脑是否在同一局域网，Web 服务是否已开启"
        : "连接失败",
    };
  }
}
