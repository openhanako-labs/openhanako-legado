// tools/legado_regenerate_reading_portrait.js
// 重新生成阅读画像。
// 对应 weread 的 weread_regenerate_reading_portrait。

import legado_get_reading_portrait from "./legado_get_reading_portrait.js";

export default async function legado_regenerate_reading_portrait(
  { dataDir, model } = {}
) {
  return await legado_get_reading_portrait({ forceRefresh: true }, { dataDir, model });
}
