// tools/legado_reading_trends.js
// 阅读习惯趋势 — 从阅读时间线数据聚合趋势统计。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";

export default async function legado_reading_trends(
  { days = 30 } = {},
  { dataDir } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) return { ok: false, code: "no_service", message: "未配置服务地址" };

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);

    // 收集所有阅读事件（durChapterTime 时间戳）
    const events = [];
    for (const b of books) {
      if (b.durChapterTime && b.durChapterTime > 0) {
        events.push({
          time: b.durChapterTime,
          bookName: b.name,
          chapter: b.durChapterTitle,
          bookUrl: b.bookUrl,
        });
      }
    }

    events.sort((a, b) => a.time - b.time);

    const now = Date.now();
    const oneDay = 86400000;
    const dailyMap = {};
    const hourMap = {};
    let maxStreak = 0;
    let currentStreak = 0;
    let lastDate = null;

    for (let i = 0; i < days; i++) {
      const d = new Date(now - i * oneDay);
      const key = d.toISOString().split("T")[0];
      dailyMap[key] = 0;
    }

    for (const e of events) {
      const d = new Date(e.time);
      const dayKey = d.toISOString().split("T")[0];
      if (dailyMap[dayKey] !== undefined) dailyMap[dayKey]++;
      const h = d.getHours();
      hourMap[h] = (hourMap[h] || 0) + 1;
    }

    // 连续阅读天数
    const sortedDays = Object.keys(dailyMap).sort();
    for (const day of sortedDays) {
      if ((dailyMap[day] || 0) > 0) {
        if (lastDate) {
          const diff = (new Date(day) - new Date(lastDate)) / oneDay;
          if (diff <= 1.5) currentStreak++;
          else currentStreak = 1;
        } else {
          currentStreak = 1;
        }
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
      lastDate = day;
    }

    // 活跃时段
    let peakHour = 0, peakCount = 0;
    for (const [h, c] of Object.entries(hourMap)) {
      if (c > peakCount) { peakHour = Number(h); peakCount = c; }
    }

    // 近 7 天 vs 前 7 天对比
    const recent7 = [];
    const prev7 = [];
    const sortedKeys = Object.keys(dailyMap).sort().reverse();
    for (let i = 0; i < Math.min(7, sortedKeys.length); i++) {
      recent7.push(dailyMap[sortedKeys[i]] || 0);
    }
    for (let i = 7; i < Math.min(14, sortedKeys.length); i++) {
      prev7.push(dailyMap[sortedKeys[i]] || 0);
    }
    const recentAvg = recent7.reduce((a, b) => a + b, 0) / Math.max(recent7.length, 1);
    const prevAvg = prev7.reduce((a, b) => a + b, 0) / Math.max(prev7.length, 1);

    return {
      ok: true,
      trends: {
        dailyActivity: dailyMap,
        hourlyDistribution: hourMap,
        peakHour,
        currentStreak: Math.min(currentStreak, days),
        maxStreak: Math.min(maxStreak, days),
        recentWeekAvg: Math.round(recentAvg * 10) / 10,
        prevWeekAvg: Math.round(prevAvg * 10) / 10,
        trend: recentAvg > prevAvg ? "up" : recentAvg < prevAvg ? "down" : "flat",
        totalEvents: events.length,
        activeDays: Object.values(dailyMap).filter(v => v > 0).length,
      },
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}