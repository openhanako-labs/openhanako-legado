// panel.js — 伴读 v3
const urlParams = new URLSearchParams(window.location.search);
const TOKEN = urlParams.get('token') || '';
const BASE = window.HANA_PLUGIN_BASE || '';
function coverImg(url) {
  if (!url) return '';
  var u = url.split('\n')[0].trim();
  if (!u.startsWith('http')) return '';
  return BASE + '/api/proxy-image?url=' + encodeURIComponent(u) + '&token=' + encodeURIComponent(TOKEN);
}
async function api(path, opts) {
  var sep = path.includes('?') ? '&' : '?';
  var init = {credentials:'same-origin'};
  if (opts && opts.method) { init.method = opts.method; init.headers = {'Content-Type':'application/json'}; init.body = opts.body; }
  var r = await fetch(BASE + path + sep + 'token=' + encodeURIComponent(TOKEN), init);
  var d = await r.json();
  if (!r.ok) throw new Error(d.reason||d.message||'HTTP '+r.status);
  return d;
}
function esc(s){return String(s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})}

var S = {
  url:'', connected:false, books:[], loading:false, error:null,
  tab:'home', stats:{}, statsLoaded:false, filterGroup:null,
  detail:null, chapters:[], notes:[],
  groupNames:{}, showChapters:50, chPage:0,
  reader:null, readerContent:'', readerLoading:false, readerIdx:0, readerTheme:'day',
  randomPick:null, searchQ:'', searchResults:[], searching:false,
  fontSize:17, askResults:'', askLoading:false, askQ:'',
  portrait:null, portraitLoading:false, timeline:null, timelineLoading:false,
  shelfLoading:false, shelfError:null,
  detailLoading:false, chapterError:null, notesError:null,
  statsLoading:false, statsError:null,
  searchError:null, searchMode:'bookstore',
  notesList:[], notesLoading:false,
  trends:null, trendsLoading:false,
  recap:null, recapLoading:false, recappedBooks:{},
  readerBookUrl:null,
  gridMode:true,
};
function toast(msg, type) {
  var c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.className = 'toast-container'; document.body.appendChild(c); }
  var el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(function(){ el.style.animation='tout .3s ease-in forwards';setTimeout(function(){c.removeChild(el)},300); }, 2500);
}

var SPINE_COLORS = ['#A8573A','#7A9B6D','#6B7FA8','#C49A6C','#7A6B8A'];

function switchView(id) {
  S.tab = id;
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active')});
  var t = document.getElementById('v-'+id);
  if (t) { t.classList.add('active'); t.classList.remove('view-in'); void t.offsetWidth; t.classList.add('view-in'); }
  document.querySelectorAll('.bnav-btn').forEach(function(b){b.classList.remove('active')});
  var btn = document.querySelector('.bnav-btn[data-view="'+id+'"]');
  if (btn) btn.classList.add('active');
  S.error = null;
  if (id === 'library') { S.detail = null; S.filterGroup = null; S.randomPick = null; }
  if (id === 'profile') { loadStats(); }
  if (id === 'notes') loadNotes();
}

function render() {
  var root = document.getElementById('root');
  if (!root) return;
  if (S.reader) { root.innerHTML = renderReader(); return; }
  if (S.detail) { root.innerHTML = renderDetail(); return; }
  var html = '<div class="page">';
  html += '<div class="top-bar"><div class="brand' + (S.connected?' live':'') + '">伴读</div><div class="info" data-act="switch" data-view="profile">' + esc(S.connected?'已连接':S.error||'未连接') + '</div></div>';
  html += '<div id="v-home" class="view' + (S.tab==='home'?' active':'') + '">' + homeHtml() + '</div>';
  html += '<div id="v-library" class="view' + (S.tab==='library'?' active':'') + '">' + libraryHtml() + '</div>';
  html += '<div id="v-explore" class="view' + (S.tab==='explore'?' active':'') + '">' + exploreHtml() + '</div>';
  html += '<div id="v-profile" class="view' + (S.tab==='profile'?' active':'') + '">' + profileHtml() + '</div>';
  html += '<div id="v-notes" class="view' + (S.tab==='notes'?' active':'') + '">' + notesHtml() + '</div>';
  html += '</div>' + bottomNavHtml() + onboardingHtml();
  root.innerHTML = html;
}

function bottomNavHtml() {
  var t = [['home','首页','<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"><path d=\"M3 9l7-7 7 7v8a1 1 0 01-1 1H4a1 1 0 01-1-1V9z\"/><path d=\"M8 16h4\"/></svg>'],
    ['library','书架','<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"><path d=\"M4 19V6a2 2 0 012-2h8v15H6a2 2 0 01-2-2zM8 5v5\"/><path d=\"M11 5v5\"/><path d=\"M14 5v5\"/></svg>'],
    ['explore','探索','<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"><circle cx=\"9\" cy=\"9\" r=\"4\"/><path d=\"M14 14l3.5 3.5\"/></svg>'],
    ['notes','笔记','<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"><path d=\"M5 3h10a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z\"/><path d=\"M8 7h4M8 10h4M8 13h2\"/></svg>'],
    ['profile','我的','<svg viewBox=\"0 0 20 20\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"><circle cx=\"10\" cy=\"7\" r=\"3\"/><path d=\"M4 17c0-2.2 2.7-4 6-4s6 1.8 6 4\"/></svg>']];
  var h = '<nav class=\"bottom-nav\"><div class=\"bnav-inner\">';
  for (var i = 0; i < t.length; i++) {
    var a = S.tab === t[i][0] ? ' active' : '';
    h += '<button class=\"bnav-btn' + a + '\" data-act=\"switch\" data-view=\"' + t[i][0] + '\">' + t[i][2] + t[i][1] + '</button>';
  }
  return h + '</div></nav>';
}
function homeHtml() {
  if (!S.connected) return disconnectedHtml();
  if (S.shelfLoading) return loadingHtml("同步书架中……");
  var reading = S.books.filter(function(b){return b.durChapterTitle&&b.durChapterTitle.length>0});
  var cur = reading[0]||null;
  var h = "";
  if (cur) {
    var pct = cur.totalChapterNum>0?Math.round(((cur.durChapterIndex||0)+1)/cur.totalChapterNum*100):0;
    h += '<div class="current-reading"><div class="eyebrow">正在读</div>';
    h += '<h1>'+esc(cur.title||cur.name||"")+'</h1>';
    if(cur.author)h+='<div class="byline">'+esc(cur.author)+'</div>';
    h += '<div class="progress"><span class="track"><span class="fill" style="width:'+pct+'%;background:var(--rust)"></span></span>';
    h += '<div class="meta"><span>'+esc(cur.durChapterTitle||"")+'</span><span class="pct">'+pct+'%</span></div></div>';
    h += '<button class="action-continue" data-act="detail" data-bid="'+esc(cur.bookUrl||cur.bookId||"")+'">继续阅读 <span class="arrow">→</span></button></div>';
  } else {
    h += '<div class="empty-state"><span class="icon">📖</span><div class="title">暂无在读</div><div class="desc">去书架看看有什么想读的</div></div>';
  }
  h += '<div class="mini-stats">';
  h += '<div class="mini-stat" data-act="switch" data-view="profile"><div class="num">'+S.books.length+'</div><div class="lbl">藏书</div></div>';
  h += '<div class="mini-stat"><div class="num">'+reading.length+'</div><div class="lbl">在读</div></div>';
  h += '<div class="mini-stat"><div class="num">'+(S.stats?.finished||0)+'</div><div class="lbl">已完结</div></div></div>';
  var recent = S.books.filter(function(b){return b.durChapterTime}).sort(function(a,b){return(b.durChapterTime||0)-(a.durChapterTime||0)}).slice(0,5);
  if(recent.length>0){
    h += '<div class="journal"><div class="label">最近阅读</div>';
    for(var i=0;i<recent.length;i++){
      var b=recent[i],d=b.durChapterTime?new Date(b.durChapterTime):null,ds=d?d.toLocaleDateString("zh-CN",{month:"short",day:"numeric"}):"";
      h += '<div class="entry" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||"")+'"><div class="date">'+esc(ds)+'</div><div class="info"><div class="title">'+esc(b.name||"")+'</div>'+(b.durChapterTitle?'<div class="ch">'+esc(b.durChapterTitle)+'</div>':"")+'</div></div>';
    }
    h += '</div>';
  }
  return h;
}
function disconnectedHtml(){return'<div class="disconnected-state"><span class="icon">🔌</span><div class="title">未连接到服务</div><div class="desc">请确保Legado Web服务已开启</div><button class="btn" data-act="switch" data-view="profile">配置地址</button></div>';}
function loadingHtml(t){return'<div class="loading-state"><div class="pulse"></div><div class="label">'+t+'</div></div>';}
function libraryHtml(){
  if(!S.connected)return'<div class="empty-state"><span class="icon">📚</span><div class="title">书架空空</div></div>';
  if(S.shelfLoading)return loadingHtml("同步书架中……");
  var fl=S.filterGroup!=null?S.books.filter(function(b){return(b.group??0)===S.filterGroup}):S.books;
  if(fl.length===0)return'<div class="empty-state"><span class="icon">📚</span><div class="title">'+(S.filterGroup!=null?"该分组无书籍":"暂无书籍")+'</div></div>';
  var backBtn=S.filterGroup!=null?'<button class="bo" data-act="switch" data-view="library" style="font-size:12px;margin-right:8px">← 全部</button>':'';
  var h='<div class="section-label">'+backBtn+'<span>书架</span><span class="count">'+fl.length+' 本 <span style="cursor:pointer;margin-left:8px;font-size:13px;color:var(--ink-2)" data-act="gridtoggle">'+(S.gridMode?'列表':'网格')+'</span></span></div>';
  // 分组过滤
  if(!S.filterGroup&&S.stats&&S.stats.groups&&S.stats.groups.length){
    h+='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--line)">';
    for(var g=0;g<Math.min(S.stats.groups.length,10);g++){
      var gr=S.stats.groups[g];
      h+='<button class="pg" data-act="group" data-gid="'+gr.id+'" style="font-size:11px">'+gn(gr.id)+' ('+gr.count+')</button>';
    }
    h+='</div>';
  }
  if(S.gridMode){
    h+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:4px 0">';
    for(var i=0;i<Math.min(fl.length,60);i++){
      var b=fl[i];
      var cimg=coverImg(b.coverUrl||b.cover||'');
      h+='<div style="padding:10px;border-radius:8px;background:var(--bg-raised);box-shadow:var(--shadow-card);cursor:pointer" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||"")+'">';
      if(cimg)h+='<div style="width:100%;height:100px;border-radius:4px;background-image:url('+cimg+');background-size:cover;background-position:center;margin-bottom:8px"></div>';
      else h+='<div style="width:100%;height:100px;border-radius:4px;background:var(--line);display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:8px">📖</div>';
      h+='<div style="font-weight:500;font-size:13px;line-height:1.3">'+esc(b.title||b.name||"?")+'</div>';
      if(b.author)h+='<div style="font-size:11px;color:var(--ink-3);margin-top:2px">'+esc(b.author)+'</div>';
      h+='</div>';
    }
    h+='</div>';
  } else {
    for(var i=0;i<Math.min(fl.length,60);i++){
      var b=fl[i],c=SPINE_COLORS[b.group!==undefined?b.group%SPINE_COLORS.length:i%SPINE_COLORS.length];
      var cimg=coverImg(b.coverUrl||b.cover||'');
      h+='<div class="book-row s" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||"")+'">';
      if(cimg)h+='<div style="width:36px;height:48px;border-radius:4px;flex-shrink:0;background-image:url('+cimg+');background-size:cover;background-position:center"></div>';
      else h+='<span class="spine" style="background:'+c+'"></span>';
      h+='<div><div class="title">'+esc(b.title||b.name||"?")+'</div>'+(b.author?'<div class="author">'+esc(b.author)+'</div>':"")+(b.durChapterTitle?'<div class="tags"><span class="hl">'+esc(b.durChapterTitle)+'</span></div>':"")+'</div></div>';
    }
  }
  return h;
}
function exploreHtml(){
  var mode=S.searchMode||"bookstore",ph=mode==="bookstore"?"书名或作者……":"搜索正文关键词……";
  var h='<div class="section-label">探索</div><div class="search-box"><div class="hint">'+(mode==="bookstore"?"搜索书源":"全文搜索")+'</div>';
  h+='<div style="display:flex;gap:4px;margin-bottom:8px"><button class="pg'+(mode==="bookstore"?" pg-a":"")+'" data-act="searchmode" data-mode="bookstore" style="font-size:12px">📚 书源</button><button class="pg'+(mode==="fulltext"?" pg-a":"")+'" data-act="searchmode" data-mode="fulltext" style="font-size:12px">📄 全文</button></div>';
  h+='<div class="row"><input id="sq" placeholder="'+ph+'" value="'+esc(S.searchQ||"")+'"/><button class="go" data-act="searchbk">搜索</button></div></div>';
  if(S.searching)h+=loadingHtml("搜索中……");
  else if(S.searchError)h+='<div style="padding:12px 14px;background:var(--rust-tint);border-radius:8px;color:var(--rust);font-size:13px;line-height:1.6">搜索失败：'+esc(S.searchError)+'<div style="margin-top:6px"><button class="bo" data-act="searchbk" style="font-size:12px">重试</button></div></div>';
  else if(S.searchResults.length>0){
    if(mode==="fulltext"){
      for(var i=0;i<Math.min(S.searchResults.length,20);i++){
        var r=S.searchResults[i];
        h+='<div class="book-row" data-act="detail" data-bid="'+esc(r.bookUrl||"")+'"><span class="spine" style="background:var(--ink-3)"></span><div><div class="title">'+esc(r.bookTitle||"")+'</div><div class="author">'+esc(r.chapterTitle||"")+'</div><div class="tags" style="font-family:var(--font-book);font-size:12px;color:var(--ink-2);line-height:1.6;margin-top:4px">'+esc((r.snippet||"").slice(0,120))+'</div></div></div>';
      }
    } else {
      for(var i=0;i<Math.min(S.searchResults.length,30);i++){
        var b=S.searchResults[i];
        h+='<div class="book-row" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||"")+'"><span class="spine" style="background:var(--ink-3)"></span><div><div class="title">'+esc(b.title||b.name||"?")+'</div>'+(b.author?'<div class="author">'+esc(b.author)+'</div>':"")+'</div></div>';
      }
    }
  } else if(S.searchQ){h+='<div class="empty-state"><span class="icon">🔍</span><div class="title">无结果</div></div>';}
  else {
    h+='<div class="random-suggestion" data-act="pick"><div class="hint">翻翻看，下一本读什么</div><div class="action">随机抽一本 →</div></div>';
    if(S.randomPick){
      var p=S.randomPick;
      h+='<div class="book-row" data-act="detail" data-bid="'+esc(p.bookUrl||p.bookId||"")+'"><span class="spine" style="background:var(--rust)"></span><div><div class="title">'+esc(p.title||p.name||"?")+'</div>'+(p.author?'<div class="author">'+esc(p.author)+'</div>':"")+(p.durChapterTitle?'<div class="tags"><span class="hl">'+esc(p.durChapterTitle)+'</span></div>':"")+'</div></div>';
    }
  }
  return h;
}
function notesHtml(){
  if(!S.connected)return'<div class="empty-state"><span class="icon">📝</span><div class="title">请先连接</div></div>';
  if(S.notesLoading)return loadingHtml("加载笔记...");
  var h='<div class="section-label"><span>笔记</span><span class="count">'+S.notesList.length+' 条</span></div>';
  if(S.notesList.length===0){h+='<div class="empty-state"><span class="icon">📝</span><div class="title">暂无笔记</div><div class="desc">在Legado中划线或添加笔记后，点击刷新同步</div></div>';}
  else {
    var bb={};
    for(var i=0;i<S.notesList.length;i++){var n=S.notesList[i],k=n.bookName||"未知";if(!bb[k])bb[k]=[];bb[k].push(n);}
    for(var bk in bb){var ns=bb[bk];
      h+='<div style="margin-bottom:16px"><div class="section-label" style="margin-bottom:8px"><span>📖 '+esc(bk)+'</span><span class="count">'+ns.length+' 条</span></div>';
      for(var j=0;j<Math.min(ns.length,8);j++){
        h+='<div style="padding:8px 0;border-bottom:1px solid var(--line);font-family:var(--font-book);font-size:14px;line-height:1.7">'+(ns[j].chapterName?'<div style="font-size:11px;color:var(--ink-3);font-family:var(--font-ui)">'+esc(ns[j].chapterName)+'</div>':"")+esc((ns[j].content||"").slice(0,300))+'</div>';
      }
      if(ns.length>8)h+='<div style="font-size:12px;color:var(--ink-3);padding:6px 0">还有 '+(ns.length-8)+' 条……</div>';
      h+='</div>';
    }
  }
  h+='<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" data-act="notebk" style="padding:8px 18px;border:none;border-radius:6px;background:var(--rust);color:#fff;cursor:pointer;font-family:var(--font-ui);font-size:13px">🔄 刷新</button><button class="bo" data-act="exportbk" style="font-size:13px">📥 导出Markdown</button></div>';
  return h;
}
function profileHtml(){
  var s=S.stats,h='<div class="section-label">我的</div>';
  h+='<div class="profile-block"><div class="heading">阅读统计</div>';
  if(S.statsLoading){h+=loadingHtml("加载中……");}
  else if(s){h+='<div class="kv-row"><span class="k">总藏书</span><span class="v">'+(s.totalBooks||0)+'</span></div><div class="kv-row"><span class="k">已阅读</span><span class="v">'+(s.readBooks||0)+'</span></div><div class="kv-row"><span class="k">进行中</span><span class="v">'+(s.inProgress||0)+'</span></div><div class="kv-row"><span class="k">已完结</span><span class="v">'+(s.finished||0)+'</span></div>';}
  h+='</div><div class="profile-block"><div class="heading">阅读趋势</div>';
  if(S.trends){var tr=S.trends;h+='<div class="kv-row"><span class="k">本周日均</span><span class="v">'+tr.recentWeekAvg+'</span></div><div class="kv-row"><span class="k">上周日均</span><span class="v">'+tr.prevWeekAvg+'</span></div><div class="kv-row"><span class="k">趋势</span><span class="v" style="color:'+(tr.trend==="up"?"#7A9B6D":tr.trend==="down"?"#A8573A":"")+'">'+(tr.trend==="up"?"📈 上升":tr.trend==="down"?"📉 下降":"➡️ 持平")+'</span></div><div class="kv-row"><span class="k">连续阅读</span><span class="v">'+tr.currentStreak+' 天</span></div><div class="kv-row"><span class="k">活跃时段</span><span class="v">'+(tr.peakHour||"")+' 时</span></div>';}
  else if(S.trendsLoading){h+=loadingHtml("分析中……");}
  else{h+='<button class="btn" data-act="trends" style="padding:8px 18px;font-size:13px;border:1px solid var(--line-strong);border-radius:6px;background:transparent;color:var(--ink-2);cursor:pointer;font-family:var(--font-ui);width:100%">📈 查看阅读趋势</button>';}
  h+='</div><div class="profile-block"><div class="heading">💬 思问</div><div style="display:flex;gap:8px;margin-bottom:8px"><input id="askq" placeholder="问关于阅读的问题..." style="flex:1;padding:8px 12px;border:1px solid var(--line-strong);border-radius:6px;font-size:13px;font-family:var(--font-ui);color:var(--ink);background:transparent;outline:none" value="'+esc(S.askQ||"")+'" /><button class="btn" data-act="askbk" style="padding:8px 14px;border:none;border-radius:6px;background:var(--rust);color:#fff;cursor:pointer;font-family:var(--font-ui);font-size:13px">问</button></div>';
  if(S.askLoading)h+='<div style="font-size:13px;color:var(--ink-3);padding:8px 0"><span class="sp"></span> AI思考中...</div>';
  else if(S.askResults){h+='<div style="padding:10px 0;font-family:var(--font-book);font-size:14px;line-height:1.8">';var al=S.askResults.split("\n");for(var i=0;i<al.length;i++)if(al[i].trim())h+='<p style="margin-bottom:0.5em">'+esc(al[i])+'</p>';h+='</div>';}
  else h+='<div style="font-size:13px;color:var(--ink-3);padding:4px 0">基于书架数据问答</div>';
  h+='</div><div class="profile-block"><div class="heading">阅读画像</div>';
  if(S.portrait&&S.portrait.ok){var pt=S.portrait.portrait||{},raw=pt.raw||"",sm=pt.summary||pt.pref||"",tr=pt.traits||[];if(pt.pace)tr.push("阅读节奏："+pt.pace);if(pt.interests)tr.push("兴趣领域："+pt.interests);var sg=pt.suggestions||[];if(typeof pt.suggestions==="string"&&pt.suggestions)sg=[pt.suggestions];var kw=pt.keywords||[];h+='<div class="insight-card">';if(sm)h+='<div class="text">'+esc(sm)+'</div>';if(kw.length){h+='<div class="cloud">';for(var i=0;i<kw.length;i++)h+='<span>'+esc(kw[i])+'</span>';h+='</div>';}
  for(var i=0;i<tr.length;i++)h+='<div style="padding:4px 0;font-size:13px;color:var(--ink-2);border-bottom:1px solid var(--line)">• '+esc(tr[i])+'</div>';
  for(var i=0;i<sg.length;i++)h+='<div style="padding:4px 0;font-size:13px;color:var(--rust)">→ '+esc(sg[i])+'</div>';
  if(!sm&&!tr.length&&!sg.length&&raw)h+='<div class="text">'+esc(raw).replace(/\n/g,"<br>")+'</div>';h+='</div><button class="bo" data-act="regen" style="font-size:12px;margin-top:4px">重新生成</button>';}
  else{h+='<div class="insight-card"><div class="text">连接Legado后，点击下方按钮生成阅读画像。</div></div><button class="bo" data-act="regen" style="font-size:12px">生成画像</button>';}
  h+='</div><div class="profile-block"><div class="heading">设置</div>';
  h+='<div class="config-item"><span class="l">服务地址</span><input id="url" placeholder="http://192.168.x.x:1122" value="'+esc(S.url||"")+'"/></div>';
  // 分组名编辑
  if(S.stats&&S.stats.groups&&S.stats.groups.length){
    for(var g=0;g<Math.min(S.stats.groups.length,8);g++){
      var grd=S.stats.groups[g];
      h+='<div class="config-item"><span class="l" style="font-size:12px;width:60px;flex-shrink:0">'+gn(grd.id)+'</span><input class="gn-input" data-gnk="'+grd.id+'" value="'+esc(S.groupNames[String(grd.id)]||"")+'" style="flex:1;padding:6px 10px;border:1px solid var(--line-strong);border-radius:4px;font-size:13px;font-family:var(--font-ui);color:var(--ink);background:var(--bg);outline:none;text-align:right"/></div>';
    }
    h+='<div class="config-item"><button class="bo" data-act="savegn" style="font-size:12px">保存名称</button></div>';
  }
  h+='<div class="config-item" style="gap:8px;flex-wrap:wrap"><button class="btn" data-act="save" style="padding:6px 16px;font-size:12px;border:none;border-radius:6px;background:var(--rust);color:#fff;cursor:pointer;font-family:var(--font-ui)">保存</button><button class="bo" data-act="ping" style="font-size:12px">测试</button><span class="action" data-act="clear" style="color:var(--ink-3)">清除</span></div></div>';
  return h;
}
function gn(id){return S.groupNames[String(id)]||"分组"+id;}
function onboardingHtml(){
  return'<div class="onboarding hidden" id="onboarding"><span class="icon">📖</span><h2>欢迎使用伴读</h2><div class="desc">连接你的Legado开源阅读服务，在电脑上同步书架、阅读记录和笔记。</div><div class="field"><label>服务地址</label><input id="ob-url" placeholder="http://192.168.x.x:1122" value="'+esc(S.url||"")+'"/></div><div class="btn-row"><button class="btn primary" data-act="onboard-save">连接</button><button class="btn secondary" onclick="document.getElementById(\'onboarding\').classList.add(\'hidden\')">稍后</button></div></div>';
}
function renderReader(){
  var t=esc(S.reader||""),th=S.readerTheme||"day",bg=th==="day"?"#F4EFE6":th==="paper"?"#E8DCC8":"#1A1816",ink=th==="dark"?"#D6CFC4":"#2B2825";
  if(S.readerLoading)return'<div class="page" style="background:'+bg+'"><div class="loading-state"><div class="pulse"></div><div class="label">加载中……</div></div></div>';
  var h='<div class="page" id="v-reader" style="background:'+bg+';color:'+ink+'">';
  h+='<div class="reader-top"><span class="back" data-act="rback" style="color:'+(th==="dark"?"#A09A92":"var(--ink-3)")+'">← 返回</span>';
  h+='<span class="reading-progress"><span class="fill" style="width:'+(S.chapters.length>0?Math.round((S.readerIdx+1)/S.chapters.length*100):0)+'%"></span></span>';
  h+='<span class="time" style="color:'+(th==="dark"?"#A09A92":"var(--ink-3)")+'">'+(S.readerIdx+1)+"/"+S.chapters.length+'</span></div>';
  h+='<div class="reader-title" style="color:'+(th==="dark"?"#D6CFC4":"var(--ink-2)")+'">'+t+'</div>';
  h+='<div class="body" style="font-size:'+S.fontSize+'px;color:'+ink+'">';
  var ps=S.readerContent.split("\n");
  for(var i=0;i<ps.length;i++)if(ps[i].trim())h+="<p>"+esc(ps[i])+"</p>";
  h+='</div>';
  h+='<div class="reader-options"><div class="font-slider"><label style="color:'+(th==="dark"?"#A09A92":"var(--ink-3)")+'">A</label>';
  h+='<input type="range" min="14" max="22" value="'+S.fontSize+'" oninput="S.fontSize=+this.value;renderReader()">';
  h+='<label style="font-size:1.1em;color:'+(th==="dark"?"#A09A92":"var(--ink-3)")+'">A</label></div>';
  h+='<div style="display:flex;gap:6px"><span class="theme-dot day'+(th==="day"?" active":"")+'" data-act="readtheme" data-theme="day" title="白天"></span><span class="theme-dot paper'+(th==="paper"?" active":"")+'" data-act="readtheme" data-theme="paper" title="纸页"></span><span class="theme-dot dark'+(th==="dark"?" active":"")+'" data-act="readtheme" data-theme="dark" title="深夜"></span></div></div>';
  h+='<div class="footer"><button class="nav-btn" data-act="prevch">← 上一章</button><button class="nav-btn" data-act="nextch">下一章 →</button><span class="back-link" data-act="rback">返回</span></div></div>';
  return h;
}
function setReaderTheme(th){S.readerTheme=th;renderReader();}
function renderDetail(){
  var d=S.detail,total=S.chapters.length,per=50,cp=S.chPage,pc=Math.ceil(total/per),start=cp*per,end=Math.min(start+per,total);
  var pages="";
  if(pc>1){pages='<div class="pg-wrap">';for(var p=0;p<pc;p++)pages+='<button class="pg'+(p===cp?" pg-a":"")+'" data-act="chpage" data-p="'+p+'">'+(p+1)+'</button> ';pages+='</div>';}
  var h='<div class="page"><div class="top-bar"><span class="brand" style="cursor:pointer" data-act="close-detail">← 返回</span></div>';
  h+='<div class="profile-block"><div class="d-header" style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px">';
  h+='<div style="width:64px;height:90px;border-radius:4px;background:var(--line);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-family:var(--font-book);color:var(--ink-2)">📖</div>';
  h+='<div style="flex:1"><div style="font-family:var(--font-book);font-size:18px;font-weight:500;line-height:1.3">'+esc(d.title||"")+'</div>';
  if(d.author)h+='<div style="font-size:13px;color:var(--ink-2);margin-top:2px">'+esc(d.author)+'</div>';
  if(d.intro)h+='<div style="font-size:13px;line-height:1.7;margin-top:8px;color:var(--ink-2);font-family:var(--font-book);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">'+esc(d.intro)+'</div>';
  h+='</div></div>';
  h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
  h+='<button class="btn" style="padding:8px 18px;border:none;border-radius:6px;background:var(--rust);color:#fff;cursor:pointer;font-family:var(--font-ui);font-size:13px" data-act="readch" data-ch="'+(d.curIdx||0)+'">继续阅读</button>';
  h+='<button class="bo" data-act="recapbk" style="font-size:12px">📋 前情提要</button></div>';
  if(S.recap&&S.recap.ok&&S.recap.recap)h+='<div style="padding:14px;background:var(--bg-raised);border-radius:8px;margin-bottom:16px;font-family:var(--font-book);font-size:13px;line-height:1.8;color:var(--ink-2)"><div style="font-size:12px;font-weight:600;color:var(--ochre);margin-bottom:8px">📋 前情提要</div>'+esc(S.recap.recap)+'</div>';
  if(S.recapLoading)h+='<div style="text-align:center;padding:16px;color:var(--ink-3);font-size:13px"><span class="sp"></span> 生成中...</div>';
  // 章节
  if(S.chapterError){h+='<div style="padding:12px;background:var(--rust-tint);border-radius:8px;color:var(--rust);font-size:13px;margin-bottom:12px">章节加载失败：'+esc(S.chapterError)+'</div>';}
  else if(total){h+=pages+'<div class="profile-block"><div class="heading">章节 ('+total+')</div>';for(var i=start;i<end;i++){var ch=S.chapters[i],t=typeof ch==="string"?ch:(ch.title||ch.name||"第"+(i+1)+"章");h+='<div class="ch-item" data-act="readch" data-ch="'+i+'">'+esc(t)+'</div>';}h+='</div>';}
  else if(S.chapters.length===0){h+='<div style="padding:20px;text-align:center;color:var(--ink-3);font-size:13px">该书不在书架中，暂无章节信息</div>';}
  // 笔记
  if(S.notesError){h+='<div style="padding:12px;background:var(--rust-tint);border-radius:8px;color:var(--rust);font-size:13px;margin-bottom:12px">笔记加载失败：'+esc(S.notesError)+'</div>';}
  else if(S.notes.length){h+='<div class="profile-block"><div class="heading">笔记 ('+S.notes.length+')</div>';for(var i=0;i<Math.min(S.notes.length,8);i++){var nt=S.notes[i];h+='<div style="padding:8px 0;border-bottom:1px solid var(--line);font-family:var(--font-book);font-size:13px;line-height:1.7">'+(nt.chapterName?'<div style="font-size:11px;color:var(--ink-3);font-family:var(--font-ui)">'+esc(nt.chapterName)+'</div>':"")+esc(nt.content||nt.text||"")+'</div>';}h+='</div>';}
  h+='</div></div>';
  return h;
}
function closeDetail(){S.detail=null;render();}
document.addEventListener("DOMContentLoaded",function(){
  document.getElementById("root")?.addEventListener("click",function(e){
    var t=e.target.closest("[data-act]");if(!t)return;
    var act=t.dataset.act;
    if(act==="switch"){switchView(t.dataset.view);}
    else if(act==="group"){S.filterGroup=Number(t.dataset.gid);switchView("library");}
    else if(act==="detail"){var b=S.books.find(function(x){return(x.bookUrl||x.bookId||"")===t.dataset.bid});if(!b)b=S.searchResults.find(function(x){return(x.bookUrl||x.bookId||"")===t.dataset.bid});if(b)openDetail(b);}
    else if(act==="close-detail"){closeDetail();}
    else if(act==="readch"){var ri=Number(t.dataset.ch);var bk=S.detail.bookUrl;closeDetail();readChapter(ri,bk);}
    else if(act==="rback"){S.reader=null;switchView("home");}
    else if(act==="prevch"){readChapter(S.readerIdx-1);}
    else if(act==="nextch"){readChapter(S.readerIdx+1);}
    else if(act==="chpage"){S.chPage=Number(t.dataset.p);render();}
    else if(act==="ping"){doPing();}
    else if(act==="save"){doSave();}
    else if(act==="clear"){doClear();}
    else if(act==="savegn"){saveGroupNames();}
    else if(act==="askbk"){doAsk();}
    else if(act==="fsize"){S.fontSize=Number(t.dataset.s);renderReader();}
    else if(act==="readtheme"){setReaderTheme(t.dataset.theme);}
    else if(act==="pick"){doPick();}
    else if(act==="searchbk"){doSearch();}
    else if(act==="searchmode"){S.searchMode=t.dataset.mode;S.searchResults=[];S.searchQ="";render();}
    else if(act==="gridtoggle"){S.gridMode=!S.gridMode;render();}
    else if(act==="regen"){loadPortrait(true);}
    else if(act==="notebk"){loadNotes(true);}
    else if(act==="exportbk"){doExportNotes();}
    else if(act==="trends"){loadTrends();}
    else if(act==="recapbk"){loadRecap();}
    else if(act==="onboard-save"){doOnboardSave();}
  });
  loadGroupNames();render();setTimeout(checkLogin,100);
});
function doPick(){
  if(!S.books.length)return;
  var b;do{b=S.books[Math.floor(Math.random()*S.books.length)]}while(b===S.randomPick&&S.books.length>1);
  S.randomPick=b;render();
}
function doSearch(){
  var q=(document.getElementById("sq")||{}).value||"";
  if(!q.trim())return;
  S.searchQ=q.trim();S.searching=true;S.searchResults=[];S.searchError=null;render();
  var mode=S.searchMode||"bookstore",url=mode==="fulltext"?"/api/fulltext-search?q="+encodeURIComponent(S.searchQ):"/api/search-bookstore?keyword="+encodeURIComponent(S.searchQ);
  (async function(){
    try{
      var r=await api(url);
      if(mode==="fulltext"){S.searchResults=r.ok?(r.results||[]):[];S.searchError=r.ok?null:(r.message||"搜索失败");}
      else{S.searchResults=r.ok?(r.books||[]):[];S.searchError=r.ok?null:(r.message||"搜索无结果");}
    }catch(e){S.searchError=e.message;S.searchResults=[];}
    S.searching=false;render();
  })();
}
function doAsk(){
  var q=(document.getElementById("askq")||{}).value||"";if(!q.trim())return;
  S.askQ=q.trim();S.askLoading=true;S.askResults="";render();
  (async function(){
    try{var r=await api("/api/llm/chat",{method:"POST",body:JSON.stringify({messages:[{role:"user",content:S.askQ}],bookUrl:null})});if(r.ok)S.askResults=r.answer||r.text||"（无回答）";else S.askResults="LLM错误: "+(r.message||"未知");}catch(e){S.askResults="请求失败: "+e.message;}
    S.askLoading=false;render();
  })();
}
function doPing(){
  S.url=(document.getElementById("url")||{}).value||"";if(!S.url){S.error="输入地址";render();return}
  if(!S.url.startsWith("http"))S.url="http://"+S.url;
  (async function(){
    try{
      await api("/api/credentials?method=POST&url="+encodeURIComponent(S.url));
      var r=await api("/api/user-info");
      if(r.logged){S.connected=true;S.books=[];S.error=null;S.shelfLoading=true;render();
        try{var sr=await api("/api/shelf");if(sr.ok){S.books=sr.books||[];S.shelfError=null;}else{S.shelfError=sr.message||"获取书架失败";}}catch(e){S.shelfError=e.message;}
        S.shelfLoading=false;render();toast("连接成功","success");
      }else{S.connected=false;S.error=r.message||r.hint||"失败";toast("连接失败: "+S.error,"error");}
    }catch(e){S.connected=false;S.error=e.message;toast("连接失败: "+e.message,"error");}
    render();
  })();
}
function doSave(){
  S.url=(document.getElementById("url")||{}).value||"";if(!S.url){S.error="输入地址";render();return}
  if(!S.url.startsWith("http"))S.url="http://"+S.url;
  (async function(){try{await api("/api/credentials?method=POST&url="+encodeURIComponent(S.url));S.error=null;toast("服务地址已保存","success");}catch(e){S.error=e.message;toast("保存失败: "+e.message,"error");}render();})();
}
function doClear(){
  (async function(){try{await api("/api/credentials?method=clear");}catch(e){}
    S.connected=false;S.books=[];S.url="";S.error=null;S.stats={};S.statsLoaded=false;S.groupNames={};toast("凭据已清除","success");render();
  })();
}
function doOnboardSave(){
  S.url=(document.getElementById("ob-url")||{}).value||"";if(!S.url)return;
  document.getElementById("onboarding").classList.add("hidden");
  doPing();
}
function doExportNotes(){
  if(!S.connected){toast("请先连接","error");return}
  toast("正在导出…");
  (async function(){
    try{
      var r=await api("/api/notes-export",{method:"POST",body:JSON.stringify({writeToObsidian:true})});
      if(r.ok&&r.filePath)toast("已导出到 Obsidian: "+r.filePath,"success");
      else if(r.ok&&r.markdown)toast("已生成 "+r.count+" 条笔记","success");
      else toast("导出失败: "+(r.message||"未知"),"error");
    }catch(e){toast("导出失败: "+e.message,"error");}
  })();
}
function saveGroupNames(){
  var inputs=document.querySelectorAll(".gn-input");
  for(var i=0;i<inputs.length;i++){var inp=inputs[i],k=inp.dataset.gnk,v=inp.value.trim();if(v)S.groupNames[k]=v;}
  (async function(){try{await api("/api/group-names",{method:"POST",body:JSON.stringify({names:S.groupNames})});}catch(e){}})();
}
async function openDetail(b){
  S.detail={bookUrl:b.bookUrl||b.bookId||"",title:b.title||b.name||"",author:b.author||"",cover:b.coverUrl||b.cover||"",intro:b.intro||"",curIdx:b.durChapterIndex||0};
  S.chapters=[];S.notes=[];S.chPage=0;S.chapterError=null;S.notesError=null;S.recap=null;S.recapLoading=false;render();
  try{var r=await api("/api/book-chapters?bookId="+encodeURIComponent(S.detail.bookUrl));if(r.ok)S.chapters=r.chapters||[]}catch(e){S.chapterError=e.message;}
  try{var r=await api("/api/book-notes?bookId="+encodeURIComponent(S.detail.bookUrl));if(r.ok)S.notes=r.notes||[]}catch(e){S.notesError=e.message;}
  render();
}
async function readChapter(idx,bookUrl){S.readerBookUrl=bookUrl||S.readerBookUrl;
  var i=Number(idx),ch=S.chapters[i],title=typeof ch==="string"?ch:(ch.title||ch.name||"第"+(i+1)+"章");
  var bu=bookUrl||(S.detail?S.detail.bookUrl:null);
  if(!bu){S.readerContent="加载失败: 无法获取书籍信息";S.readerLoading=false;renderReader();return;}
  S.readerIdx=i;S.reader=title;S.readerLoading=true;S.readerContent="";renderReader();
  try{var r=await api("/api/chapter-content?bookId="+encodeURIComponent(bu)+"&index="+i);if(r.ok)S.readerContent=r.content||"";else S.readerContent="加载失败: "+(r.message||"");}catch(e){S.readerContent="加载失败: "+e.message;}
  S.readerLoading=false;renderReader();
}
async function loadStats(){
  if(S.statsLoaded)return;
  S.statsLoading=true;S.statsError=null;render();
  try{if(!S.connected)throw new Error("未连接");var r=await api("/api/reading-stats");if(r.ok&&r.stats){S.stats=r.stats;S.statsLoaded=true;S.statsError=null;}else{S.statsError=r.message||"获取统计失败";}}catch(e){S.statsError=e.message;}
  S.statsLoading=false;render();
}
async function loadGroupNames(){
  try{var gnr=await api("/api/group-names");if(gnr.ok)S.groupNames=Object.assign({0:"默认",1:"追更",2:"养肥",16:"待分类"},gnr.names||{})}catch(e){}
}
async function loadPortrait(force){
  S.portraitLoading=true;S.portrait=null;render();
  try{var r=await api("/api/portrait"+(force?"?force=1":""));S.portrait=r;}catch(e){S.portrait={ok:false,message:e.message};}
  S.portraitLoading=false;render();
}
async function checkLogin(){
  try{
    var r=await api("/api/login-status");
    if(r.logged){S.connected=true;S.url=r.serviceUrl||S.url;S.shelfLoading=true;render();
      try{var sr=await api("/api/shelf");if(sr.ok){S.books=sr.books||[];S.shelfError=null;}else{S.shelfError=sr.message||"获取书架失败";}}catch(e){S.shelfError=e.message;}
      S.shelfLoading=false;render();
    }else{S.error=r.message||r.hint||"";if(r.serviceUrl)S.url=r.serviceUrl;}
  }catch(e){S.error=e.message;}
  render();
}
async function loadNotes(force){
  if(!S.connected)return;
  S.notesLoading=true;render();
  try{var r=await api("/api/notes-timeline?limit=100");if(r.ok)S.notesList=r.notes||[];else S.notesList=[];}catch(e){S.notesList=[];}
  S.notesLoading=false;render();
}
async function loadTrends(){
  if(!S.connected)return;
  S.trendsLoading=true;render();
  try{var r=await api("/api/reading-trends?days=30");if(r.ok)S.trends=r.trends||null;else S.trends=null;}catch(e){S.trends=null;}
  S.trendsLoading=false;render();
}
async function loadRecap(){
  if(!S.detail||!S.detail.bookUrl){toast("请先选择一本书","error");return}
  S.recapLoading=true;S.recap=null;render();
  try{var r=await api("/api/recap?bookId="+encodeURIComponent(S.detail.bookUrl));if(r.ok)S.recap=r;else S.recap={ok:false,message:r.message};}catch(e){S.recap={ok:false,message:e.message};}
  S.recapLoading=false;render();
}
