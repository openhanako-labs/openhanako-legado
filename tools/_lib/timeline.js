// _lib/timeline.js
// 阅读时间线——复用 weread-companion 的 timeline 逻辑。
// 将阅读事件按时间排序，生成时间线视图。

/**
 * 生成阅读时间线。
 */
export function buildTimeline(notes, books) {
  const events = [];

  // 笔记事件
  for (const note of (notes || [])) {
    events.push({
      type: "note",
      timestamp: note.timestamp || Date.now(),
      bookTitle: note.bookTitle || "未知",
      content: note.content || note.text || "",
    });
  }

  // 书籍加入书架事件
  for (const book of (books || [])) {
    events.push({
      type: "shelf",
      timestamp: book.startTime || book.addTime || Date.now(),
      bookTitle: book.title || book.name || "未知",
      author: book.author || book.writer || "",
    });
  }

  // 按时间排序
  events.sort((a, b) => b.timestamp - a.timestamp);
  return events;
}

/**
 * 获取最近 N 条事件。
 */
export function getRecentEvents(notes, books, limit = 20) {
  const events = buildTimeline(notes, books);
  return events.slice(0, limit);
}
