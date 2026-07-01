// panel.js — 完整版
const urlParams = new URLSearchParams(window.location.search);
const TOKEN = urlParams.get('token') || '';
const BASE = window.HANA_PLUGIN_BASE || '';
const coverImg = function(url) {
  if (!url) return '';
  var u = url.split('\n')[0].trim();
  if (!u.startsWith('http')) return '';
  return BASE + '/api/proxy-image?url=' + encodeURIComponent(u) + '&token=' + encodeURIComponent(TOKEN);
};

async function api(path, opts) {
  var sep = path.includes('?') ? '&' : '?';
  var init = {credentials:'same-origin'};
  if (opts && opts.method) { init.method = opts.method; init.headers = {'Content-Type':'application/json'}; init.body = opts.body; }
  var r = await fetch(BASE + path + sep + 'token=' + encodeURIComponent(TOKEN), init);
  var d = await r.json();
  if (!r.ok) throw new Error(d.reason||d.message||'HTTP '+r.status);
  return d;
}
var esc = function(s){return String(s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})};

var S = {
  url:'', connected:false, books:[], loading:false, error:null,
  tab:'shelf', stats:{}, statsLoaded:false, filterGroup:null,
  detail:null, chapters:[], notes:[],
  groupNames:{}, showChapters:50, chPage:0,
  reader:null, readerContent:'', readerLoading:false, readerIdx:0,
  randomPick:null, searchQ:'', searchResults:[], searching:false,
  fontSize:16, askResults:'', askLoading:false, askQ:'',
  portrait:null, portraitLoading:false, timeline:null, timelineLoading:false,
  shelfLoading:false, shelfError:null,
  detailLoading:false, chapterError:null, notesError:null,
  statsLoading:false, statsError:null,
  searchError:null,
};

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('root')?.addEventListener('click', function(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.dataset.act;
    if (act === 'switch') { S.tab=t.dataset.tab;S.detail=null;S.filterGroup=null;S.error=null;S.randomPick=null;render();if(S.tab==='stats')loadStats(); }
    else if (act === 'group') { S.filterGroup=Number(t.dataset.gid);S.tab='shelf';S.detail=null;render(); }
    else if (act === 'back') { S.detail=null;render(); }
    else if (act === 'detail') { var b=S.books.find(function(x){return(x.bookUrl||x.bookId||'')===t.dataset.bid});if(!b)b=S.searchResults.find(function(x){return(x.bookUrl||x.bookId||'')===t.dataset.bid});if(b)openDetail(b); }
    else if (act === 'chpage') { S.chPage=Number(t.dataset.p);render(); }
    else if (act === 'readch') { readChapter(Number(t.dataset.ch)); }
    else if (act === 'rback') { S.reader=null;render(); }
    else if (act === 'prevch') { readChapter(S.readerIdx-1); }
    else if (act === 'nextch') { readChapter(S.readerIdx+1); }
    else if (act === 'ping') doPing(); else if (act === 'save') doSave(); else if (act === 'clear') doClear();
    else if (act === 'savegn') saveGroupNames();
    else if (act === 'askbk') doAsk();
    else if (act === 'notebk') loadNotes(true);
    else if (act === 'exportbk') doExportNotes();
    else if (act === 'fsize') { S.fontSize=Number(t.dataset.s);render(); }
    else if (act === 'pick') doPick();
    else if (act === 'searchbk') doSearch();
    else if (act === 'regen') loadPortrait();
    else if (act === 'stats') { S.tab='stats';render();loadStats(); }
  });
  loadGroupNames();
  render();
  setTimeout(checkLogin, 100);
});

function render() {
  var root = document.getElementById('root');
  if (!root) return;
  if (S.reader) { root.innerHTML = '<div class="p-16">'+readerHtml(S.readerContent)+'</div>'; return; }
  if (S.detail) { root.innerHTML = detailHtml(); return; }
  var tabs=[['shelf','📚 书架'],['pick','🎲 拾遗'],['search','🔍 搜'],['ask','💬 思问'],['stats','📊 统'],['portrait','🧠 画像'],['notes','📝 笔'],['config','⚙ 设']];
  var nav='<div class="nv">';
  for(var i=0;i<tabs.length;i++) {
    nav+='<button class="nv-b'+(S.tab===tabs[i][0]?' nv-a':'')+'" data-act="switch" data-tab="'+tabs[i][0]+'">'+tabs[i][1]+'</button>';
  }
  nav+='</div>';
  var cls=S.connected?'bg-green':(S.error?'bg-red':'bg-gray');
  var txt=S.connected?'✓ 已连接':(S.error?'✗ '+S.error:'请先配置地址');
  var content='';
  if (S.tab==='pick') content=pickHtml();
  else if (S.tab==='search') content=searchHtml();
  else if (S.tab==='stats') content=statsHtml();
  else if (S.tab==='portrait') content=portraitHtml();
  else if (S.tab==='notes') content=notesHtml();
  else if (S.tab==='ask') content=askHtml();
  else if (S.tab==='config') content=configHtml();
  else content=shelfHtml();
  root.innerHTML = '<div class="st '+cls+'"><span class="dot"></span>'+esc(txt)+'</div>'+nav+content;
}

function shelfHtml() {
  var fl=S.filterGroup!=null?S.books.filter(function(b){return(b.group??0)===S.filterGroup}):S.books;
  var backBtn=S.filterGroup!=null?'<button class="bo" style="margin-right:8px" data-act="switch" data-tab="shelf">← 全部</button>':'';
  var title=S.filterGroup!=null?'📁 '+gn(S.filterGroup):'📚 书架';
  if(!S.connected) return '<div class="cd"><div class="ch">'+backBtn+title+'</div><div class="cb"><div class="em">请先设置地址</div></div></div>';
  if(S.shelfLoading) return '<div class="cd"><div class="ch">'+backBtn+title+'</div><div class="cb"><div class="em"><span class="sp"></span> 加载书架中...</div></div></div>';
  if(S.shelfError) return '<div class="cd"><div class="ch">'+backBtn+title+'</div><div class="cb"><div style="margin:12px 18px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.6">书架加载失败：'+esc(S.shelfError)+'<div style="margin-top:6px"><button class="bp" style="font-size:12px" data-act="ping">重新连接</button></div></div></div></div>';
  if(!fl.length){var m=S.filterGroup!=null?'该分组无书籍':'无书籍';return '<div class="cd"><div class="ch">'+backBtn+title+'</div><div class="cb"><div class="em">'+m+'</div></div></div>';}
  var html='<div class="cd"><div class="ch">'+backBtn+title+' <span class="sub">'+fl.length+' 本</span></div><div class="cb"><div class="shelf-grid">';
  for(var i=0;i<Math.min(fl.length,60);i++) {
    var b=fl[i];
    var cimg=coverImg(b.coverUrl||b.cover||'');
    html+='<div class="shelf-card" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||'')+'">';
    if(cimg) html+='<div class="shelf-cover" style="background-image:url('+cimg+');background-size:cover;background-position:center;font-size:0">📖</div>';
    else html+='<div class="shelf-cover">📖</div>';
    html+='<div class="shelf-meta"><div class="shelf-title">'+esc(b.title||b.name||'?')+'</div>';
    if(b.author) html+='<div class="shelf-author">'+esc(b.author)+'</div>';
    if(b.durChapterTitle) html+='<div class="shelf-chapter">'+esc(b.durChapterTitle)+'</div>';
    html+='</div></div>';
  }
  return html+'</div></div></div>';
}

function detailHtml() {
  var d=S.detail, total=S.chapters.length, per=50, cp=S.chPage, pc=Math.ceil(total/per);
  var start=cp*per, end=Math.min(start+per,total);
  var pages='';
  if(pc>1){pages='<div style="padding:8px 14px">';for(var p=0;p<pc;p++)pages+='<button class="pg'+(p===cp?' pg-a':'')+'" data-act="chpage" data-p="'+p+'">'+(p+1)+'</button> ';pages+='<span style="font-size:11px;color:var(--slate)">共'+total+'章</span></div>';}
  var cimg=coverImg(d.cover||'');
  var html='<div class="cd"><div class="ch"><button class="bo" style="margin-right:8px" data-act="back">← 返回</button>'+esc(d.title||'')+'</div>';
  html+='<div class="cb"><div class="fl" style="display:flex;gap:14px;align-items:flex-start">';
  if(cimg) html+='<div style="width:72px;height:100px;border-radius:4px;background:var(--line-soft);background-image:url('+cimg+');background-size:cover;background-position:center;flex-shrink:0"></div>';
  else html+='<div style="width:72px;height:100px;border-radius:4px;background:var(--line-soft);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">📖</div>';
  html+='<div><div style="font-size:15px;font-weight:600">'+esc(d.title||'')+'</div>';
  if(d.author) html+='<div style="font-size:13px;color:var(--slate);margin-top:2px">'+esc(d.author)+'</div>';
  if(d.intro) html+='<div style="font-size:13px;line-height:1.7;margin-top:8px;color:var(--ink);font-family:var(--font-book);border-left:3px solid var(--ochre);padding-left:12px">'+esc(d.intro)+'</div>';
  html+='</div></div></div></div>';
  if(S.chapterError) {
    html+='<div class="cd"><div class="ch">📑 章节</div><div class="cb"><div style="padding:10px 14px;background:#fef2f2;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.6">章节加载失败：'+esc(S.chapterError)+'<div style="margin-top:6px"><button class="bo" data-act="detail" data-bid="'+esc(d.bookUrl||'')+'" style="font-size:12px">重试</button></div></div></div></div>';
  } else if(total) html+=pages+'<div class="cd"><div class="ch">📑 章节 ('+total+')</div><div class="ch-grid">'+
    S.chapters.slice(start,end).map(function(c,i){var t=typeof c==='string'?c:(c.title||c.name||'第'+(start+i+1)+'章');return '<div class="ch-item" data-act="readch" data-ch="'+(start+i)+'">'+esc(t)+'</div>';}).join('')+
    '</div></div>';
  else if(S.chapters.length===0 && !S.chapterError) html+='<div class="cd"><div class="ch">📑 章节</div><div class="cb"><div class="em">该书不在书架中，暂无章节信息</div></div></div>';
  if(S.notesError) {
    html+='<div class="cd"><div class="ch">📝 笔记</div><div class="cb"><div style="padding:10px 14px;background:#fef2f2;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.6">笔记加载失败：'+esc(S.notesError)+'<div style="margin-top:6px"><button class="bo" data-act="detail" data-bid="'+esc(d.bookUrl||'')+'" style="font-size:12px">重试</button></div></div></div></div>';
  } else if(S.notes.length) {
    html+='<div class="cd"><div class="ch">📝 笔记 ('+S.notes.length+')</div>';
    for(var n=0;n<Math.min(S.notes.length,5);n++) {
      var nt=S.notes[n];
      html+='<div class="nt"><div class="ntc">'+esc(nt.content||nt.text||'')+'</div></div>';
    }
    html+='</div>';
  }
  return '<div class="p-16">'+html+'</div>';
}

function readerHtml(content) {
  var title=esc(S.reader||'');
  if(S.readerLoading) return '<div class="cd"><div class="ch"><button class="bo" style="margin-right:8px" data-act="rback">← 返回</button>'+title+'</div><div class="cb"><div class="em"><span class="sp"></span> 加载中...</div></div></div>';
  var fss=[12,14,16,18,20];
  var html='<div class="cd"><div class="ch"><button class="bo" style="margin-right:8px" data-act="rback">← 返回</button>'+title+'</div><div style="display:flex;gap:4px;padding:6px 14px;border-bottom:1px solid var(--line-soft)">字号:';
  for(var j=0;j<fss.length;j++) html+='<button class="pg'+(S.fontSize===fss[j]?' pg-a':'')+'" data-act="fsize" data-s="'+fss[j]+'">'+fss[j]+'</button>';
  html+='</div><div class="cb"><div class="reader" style="font-size:'+S.fontSize+'px">';
  var ps=content.split('\n');
  for(var i=0;i<ps.length;i++) if(ps[i].trim()) html+='<p class="rp">'+esc(ps[i])+'</p>';
  html+='</div><div class="rn">';
  if(S.readerIdx>0) html+='<button class="bp" data-act="prevch">← 上一章</button> ';
  if(S.readerIdx<S.chapters.length-1) html+='<button class="bp" data-act="nextch">下一章 →</button>';
  return html+'</div></div></div>';
}

// ---- 拾遗 ----
function pickHtml() {
  if(!S.connected) return '<div class="cd"><div class="ch">🎲 拾遗</div><div class="cb"><div class="em">请先连接</div></div></div>';
  if(!S.books.length) return '<div class="cd"><div class="ch">🎲 拾遗</div><div class="cb"><div class="em">书架空空...</div></div></div>';
  var b=S.randomPick;
  var html='<div class="cd"><div class="ch">🎲 拾遗</div><div class="cb"><div class="fl" style="text-align:center;padding:24px 18px">';
  if(!b) html+='<div style="margin-bottom:16px;color:var(--slate)">点一下，随机抽一本</div>';
  if(b) {
    var cimg=coverImg(b.coverUrl||b.cover||'');
    html+='<div style="cursor:pointer" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||'')+'">';
    if(cimg) html+='<div style="width:100px;height:140px;border-radius:6px;margin:0 auto 14px;background:var(--line-soft);background-image:url('+cimg+');background-size:cover;background-position:center;box-shadow:var(--shadow-2)"></div>';
    else html+='<div style="width:100px;height:140px;border-radius:6px;margin:0 auto 14px;background:var(--line-soft);display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:var(--shadow-2)">📖</div>';
    html+='<div style="font-size:16px;font-weight:600">'+esc(b.title||b.name||'?')+'</div>'+
      (b.author?'<div style="font-size:13px;color:var(--slate);margin-top:4px">'+esc(b.author)+'</div>':'')+
      (b.durChapterTitle?'<div style="font-size:12px;color:var(--ochre);margin-top:6px">'+esc(b.durChapterTitle)+'</div>':'')+
      '</div>';
  }
  html+='<div style="margin-top:20px"><button class="bp" data-act="pick">'+(b?'换一本':'抽一本')+'</button></div>';
  return html+'</div></div></div>';
}

// ---- 搜索书源 ----
function searchHtml() {
  var html='<div class="cd"><div class="ch">🔍 搜书源</div><div class="cb"><div class="fl"><div class="ir"><input id="sq" placeholder="书名、作者..." value="'+esc(S.searchQ||'')+'" /><button class="bp" data-act="searchbk">搜</button></div></div>';
  if(S.searching) html+='<div class="em"><span class="sp"></span> 搜索中...</div>';
  else if(S.searchError) {
    html+='<div style="margin:12px 18px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.6">搜索失败：'+esc(S.searchError)+'<div style="margin-top:6px"><button class="bo" data-act="searchbk" style="font-size:12px">重试</button></div></div>';
  }
  else if(S.searchResults.length) {
    html+='<div style="padding:4px 18px;font-size:12px;color:var(--slate)">'+S.searchResults.length+' 个结果</div><div class="shelf-grid">';
    for(var i=0;i<Math.min(S.searchResults.length,30);i++) {
      var b=S.searchResults[i];
      var cimg=coverImg(b.coverUrl||b.cover||'');
      html+='<div class="shelf-card" data-act="detail" data-bid="'+esc(b.bookUrl||b.bookId||'')+'">';
      if(cimg) html+='<div class="shelf-cover" style="background-image:url('+cimg+');background-size:cover">📖</div>';
      else html+='<div class="shelf-cover">📖</div>';
      html+='<div class="shelf-meta"><div class="shelf-title">'+esc(b.title||b.name||'?')+'</div>'+(b.author?'<div class="shelf-author">'+esc(b.author)+'</div>':'')+'</div></div>';
    }
    html+='</div>';
  } else if(S.searchQ) html+='<div class="em">无结果</div>';
  else html+='<div class="em">输入关键词搜索书源</div>';
  return html+'</div></div>';
}

// ---- 统计 ----
function statsHtml() {
  var s=S.stats;
  if(S.statsError) return '<div class="cd"><div class="ch">📊 阅读统计</div><div class="cb"><div style="margin:12px 18px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#b91c1c;font-size:13px;line-height:1.6">统计加载失败：'+esc(S.statsError)+'<div style="margin-top:6px"><button class="bp" style="font-size:12px" data-act="stats">重试</button></div></div></div></div>';
  if(!S.statsLoaded) return '<div class="cd"><div class="ch">📊 阅读统计</div><div class="cb"><div class="em"><span class="sp"></span> 加载中...</div></div></div>';
  if(!s) return '<div class="cd"><div class="ch">📊 阅读统计</div><div class="cb"><div class="em">暂无数据</div></div></div>';
  var html='<div class="cd"><div class="ch">📊 阅读统计</div><div class="cb"><div class="sg">'+
    si(s.totalBooks||0,'总藏书')+si(s.readBooks||0,'已阅读')+si(s.inProgress||0,'进行中')+
    si(s.finished||0,'已完结')+si(s.localBooks||0,'本地书')+si(s.onlineBooks||0,'在线书')+
    '</div>';
  var gs=s.groups||[];
  if(gs.length) {
    html+='<div class="ch" style="border-top:1px solid var(--line-soft);margin-top:4px">📁 分组分布</div><div class="sg">';
    for(var i=0;i<gs.length;i++) html+='<div class="si" style="cursor:pointer" data-act="group" data-gid="'+gs[i].id+'"><div class="sn" style="font-size:15px">'+gs[i].count+'</div><div class="sl">'+gn(gs[i].id)+'</div></div>';
    html+='</div>';
  }
  html+='<div class="ch" style="border-top:1px solid var(--line-soft);margin-top:4px">📅 最近阅读</div>'+timelineHtml();
  return html+'</div></div>';
}
function si(n,l){return '<div class="si"><div class="sn">'+n+'</div><div class="sl">'+l+'</div></div>';}

// ---- 画像 ----
function portraitHtml() {
  var p=S.portrait;
  if(S.portraitLoading) return '<div class="cd"><div class="ch">🧠 AI 阅读画像</div><div class="cb"><div class="em"><span class="sp"></span> AI 正在分析...</div></div></div>';
  if(p && p.ok) {
    var pt=p.portrait||{};
    var raw=pt.raw||'';
    var html='<div class="cd"><div class="ch">🧠 AI 阅读画像</div><div class="cb"><div class="fl">';
    // 兼容两种数据格式
    var summary=pt.summary||pt.pref||'';
    var traits=pt.traits||[];
    if(pt.pace) traits.push('阅读节奏：'+pt.pace);
    if(pt.interests) traits.push('兴趣领域：'+pt.interests);
    var suggestions=pt.suggestions||[];
    if(typeof pt.suggestions==='string' && pt.suggestions) suggestions=[pt.suggestions];
    var keywords=pt.keywords||[];
    if(summary) html+='<div style="font-family:var(--font-book);font-size:14px;line-height:1.8;margin-bottom:12px">'+esc(summary)+'</div>';
    if(traits.length) {
      html+='<div style="font-weight:600;margin-bottom:6px;color:var(--ochre)">📊 阅读特质</div>';
      for(var i=0;i<traits.length;i++) html+='<div style="padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:14px;line-height:1.6">• '+esc(traits[i])+'</div>';
    }
    if(keywords.length) {
      html+='<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
      for(var i=0;i<keywords.length;i++) html+='<span style="padding:3px 10px;background:var(--line-soft);border-radius:12px;font-size:12px;color:var(--ink)">'+esc(keywords[i])+'</span>';
      html+='</div>';
    }
    if(suggestions.length) {
      html+='<div style="font-weight:600;margin-top:14px;margin-bottom:6px;color:var(--ochre)">📚 推荐方向</div>';
      for(var i=0;i<suggestions.length;i++) html+='<div style="padding:8px 0;font-size:14px;line-height:1.6">→ '+esc(suggestions[i])+'</div>';
    }
    // 兜底：显示原始文本
    if(!summary && !traits.length && !suggestions.length && raw) {
      html+='<div style="font-family:var(--font-book);font-size:14px;line-height:1.8">'+esc(raw.slice(0,1000)).replace(/\n/g,'<br>')+'</div>';
    }
    html+='</div></div></div><div style="text-align:center;padding:0 18px 16px"><button class="bp" data-act="regen">重新生成</button><span style="font-size:11px;color:var(--slate);margin-left:8px">上次生成：'+(p._cachedAt||'')+'</span></div>';
    return html;
  }
  // 失败时显示具体错误信息
  var errHint = '';
  if (p && p.message) {
    var code = p.code || '';
    if (code === 'no_model' || code === 'llm_error') {
      errHint = '<div style="padding:12px;background:var(--bg-raised);border-radius:8px;border:1px solid var(--line-soft)"><div style="font-weight:600;color:var(--ochre);margin-bottom:6px">⚠️ LLM 未配置</div><div style="font-size:13px;color:var(--slate);line-height:1.7">画像功能需要宿主 LLM 支持。请在 Hana 设置中配置模型。当前错误：'+esc(p.message)+'</div></div>';
    } else if (code === 'no_service') {
      errHint = '<div style="padding:12px;background:var(--bg-raised);border-radius:8px;border:1px solid var(--line-soft)"><div style="font-weight:600;color:var(--ochre);margin-bottom:6px">⚠️ 服务未连接</div><div style="font-size:13px;color:var(--slate);line-height:1.7">请先在「设置」页面配置 Legado 服务地址，画像功能需要读取书架数据。</div></div>';
    } else {
      errHint = '<div style="padding:12px;background:var(--bg-raised);border-radius:8px;border:1px solid var(--line-soft)"><div style="font-size:13px;color:var(--slate);line-height:1.7">加载失败：'+esc(p.message)+'</div></div>';
    }
  } else {
    errHint = '<div style="padding:12px;background:var(--bg-raised);border-radius:8px;border:1px solid var(--line-soft)"><div style="font-size:13px;color:var(--slate);line-height:1.7">基于你的书架和阅读数据，让 AI 分析你的阅读偏好、习惯和特质。</div><div style="font-size:13px;color:var(--slate);margin-top:6px">需要连接 Legado 并启用 LLM。</div></div>';
  }
  return '<div class="cd"><div class="ch">🧠 AI 阅读画像</div><div class="cb">'+errHint+'</div></div><div style="padding:0 18px 16px"><button class="bp" data-act="regen">生成画像</button></div>';
}

// ---- 时间线 ----
function timelineHtml() {
  var ev=S.timeline||[];
  if(S.timelineLoading) return '<div class="em"><span class="sp"></span> 加载中...</div>';
  if(!ev.length) return '<div class="em">暂无阅读记录</div>';
  return ev.slice(0,10).map(function(e){
    var d=new Date(e.timestamp||0);
    return '<div style="padding:8px 18px;border-bottom:1px solid var(--line-soft)">'+
      '<div style="font-size:12px;color:var(--slate)">'+d.toLocaleDateString()+'</div>'+
      '<div style="font-size:13px;margin-top:2px">📖 '+esc(e.bookTitle||'')+'</div>'+
      (e.chapterTitle?'<div style="font-size:12px;color:var(--ochre)">'+esc(e.chapterTitle)+'</div>':'')+
      '</div>';
  }).join('');
}
function gn(id){return S.groupNames[String(id)]||'分组'+id;}

// ---- 思问 ----
function askHtml() {
  var html='<div class="cd"><div class="ch">💬 思问</div><div class="cb"><div class="fl"><div class="ir"><input id="askq" placeholder="问关于你阅读的问题..." value="'+esc(S.askQ||'')+'" /><button class="bp" data-act="askbk">问</button></div></div>';
  if(S.askLoading) html+='<div class="em"><span class="sp"></span> AI 思考中...</div>';
  else if(S.askResults) {
    html+='<div class="fl" style="border-top:1px solid var(--line-soft)">';
    var lines=S.askResults.split('\n');
    for(var i=0;i<lines.length;i++) if(lines[i].trim()) html+='<p style="line-height:1.8;margin-bottom:0.5em;font-family:var(--font-book)">'+esc(lines[i])+'</p>';
    html+='</div>';
  } else html+='<div class="em">基于你的书架和阅读数据问答，需要 LLM 支持</div>';
  return html+'</div></div>';
}

// ---- 配置 ----
function configHtml() {
  var gs=S.stats.groups||[], gnHtml='';
  if(gs.length) {
    for(var i=0;i<gs.length;i++) {
      var k=gs[i].id;
      gnHtml+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span style="width:50px;font-size:12px;color:var(--slate)">'+gn(k)+'</span><input class="gn-input" data-gnk="'+k+'" value="'+esc(S.groupNames[String(k)]||'')+'" /></div>';
    }
  }
  var fss=[12,14,16,18,20];
  var fbtns='<div style="display:flex;gap:4px">';
  for(var i=0;i<fss.length;i++) fbtns+='<button class="pg'+(S.fontSize===fss[i]?' pg-a':'')+'" data-act="fsize" data-s="'+fss[i]+'">'+fss[i]+'</button>';
  fbtns+='</div>';
  return '<div class="cd"><div class="ch">⚙ 设置</div><div class="cb"><div class="fl"><label>服务地址</label><div class="ir"><input id="url" placeholder="http://192.168.x.x:1122" value="'+esc(S.url)+'" /><button class="bp" data-act="ping">测试</button></div></div>'+
    (gnHtml?'<div class="fl" style="border-top:1px solid var(--line-soft)"><label>分组名称</label>'+gnHtml+'<div style="margin-top:8px"><button class="bp" data-act="savegn">保存名称</button></div></div>':'')+
    '<div class="fl" style="border-top:1px solid var(--line-soft)"><label>阅读字号</label>'+fbtns+'</div>'+
    '<div class="ac"><button class="bp" data-act="save">保存地址</button><button class="bo" data-act="clear">清除</button></div></div></div>';
}

// ---- Toast 通知 ----
function toast(msg, type) {
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function(){ el.style.animation='tout .3s ease-in forwards';setTimeout(function(){container.removeChild(el)},300); }, 2500);
}

// ---- 操作函数 ----
function doPick(){
  if(!S.books.length)return;
  var b;do{b=S.books[Math.floor(Math.random()*S.books.length)]}while(b===S.randomPick&&S.books.length>1);
  S.randomPick=b;render();
}
async function doSearch(){
  var q=(document.getElementById('sq')||{}).value||'';
  if(!q.trim())return;
  S.searchQ=q.trim();S.searching=true;S.searchResults=[];S.searchError=null;render();
  try{var r=await api('/api/search-bookstore?keyword='+encodeURIComponent(S.searchQ));S.searchResults=r.ok?(r.books||[]):[];S.searchError=r.ok?null:(r.message||'搜索无结果');}catch(e){S.searchError=e.message;S.searchResults=[];}
  S.searching=false;render();
}
async function doAsk(){
  var q=(document.getElementById('askq')||{}).value||'';
  if(!q.trim())return;
  S.askQ=q.trim();S.askLoading=true;S.askResults='';render();
  try{var r=await api('/api/llm/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:S.askQ}],bookUrl:null})});if(r.ok)S.askResults=r.answer||r.text||'（无回答）';else S.askResults='LLM 错误: '+(r.message||'未知');}catch(e){S.askResults='请求失败: '+e.message;}
  S.askLoading=false;render();
}
async function saveGroupNames(){
  var inputs=document.querySelectorAll('.gn-input');
  for(var i=0;i<inputs.length;i++){var inp=inputs[i];var k=inp.dataset.gnk;var v=inp.value.trim();if(v)S.groupNames[k]=v;}
  try{await api('/api/group-names',{method:'POST',body:JSON.stringify({names:S.groupNames})})}catch(e){}
}
async function doPing(){
  S.url=(document.getElementById('url')||{}).value||'';
  if(!S.url){S.error='输入地址';render();return}
  if(!S.url.startsWith('http'))S.url='http://'+S.url;
  try{
    await api('/api/credentials?method=POST&url='+encodeURIComponent(S.url));
    var r=await api('/api/login-status');
    if(r.logged){S.connected=true;S.books=[];S.error=null;S.shelfLoading=true;render();
  try{var sr=await api('/api/shelf');if(sr.ok){S.books=sr.books||[];S.shelfError=null;}else{S.shelfError=sr.message||'获取书架失败';}}catch(e){S.shelfError=e.message;}
  S.shelfLoading=false;render();
    }else{S.connected=false;S.error=r.message||r.hint||'失败';}
  }catch(e){S.connected=false;S.error=e.message;}
  render();
}
async function doSave(){
  S.url=(document.getElementById('url')||{}).value||'';
  if(!S.url){S.error='输入地址';render();return}
  if(!S.url.startsWith('http'))S.url='http://'+S.url;
  try{await api('/api/credentials?method=POST&url='+encodeURIComponent(S.url));S.error=null;toast('服务地址已保存','success')}catch(e){S.error=e.message;toast('保存失败: '+e.message,'error')}
  render();
}
async function doClear(){
  try{await api('/api/credentials?method=clear')}catch(e){}
  S.connected=false;S.books=[];S.url='';S.error=null;S.stats={};S.statsLoaded=false;S.groupNames={};
  toast('凭据已清除','success');render();
}
async function openDetail(b) {
  S.detail={bookUrl:b.bookUrl||b.bookId||'',title:b.title||b.name||'',author:b.author||'',cover:b.coverUrl||b.cover||'',intro:b.intro||''};
  S.chapters=[];S.notes=[];S.chPage=0;S.chapterError=null;S.notesError=null;render();
  try{var r=await api('/api/book-chapters?bookId='+encodeURIComponent(S.detail.bookUrl));if(r.ok)S.chapters=r.chapters||[]}catch(e){S.chapterError=e.message;}
  try{var r=await api('/api/book-notes?bookId='+encodeURIComponent(S.detail.bookUrl));if(r.ok)S.notes=r.notes||[]}catch(e){S.notesError=e.message;}
  render();
}
async function readChapter(idx) {
  var i=Number(idx),ch=S.chapters[i],title=typeof ch==='string'?ch:(ch.title||ch.name||'第'+(i+1)+'章');
  S.readerIdx=i;S.reader=title;S.readerLoading=true;S.readerContent='';render();
  try{var r=await api('/api/chapter-content?bookId='+encodeURIComponent(S.detail.bookUrl)+'&index='+i);if(r.ok)S.readerContent=r.content||'';else S.readerContent='加载失败';}catch(e){S.readerContent='加载失败';}
  S.readerLoading=false;render();
}
async function loadStats(){
  if(S.statsLoaded)return;
  S.statsLoading=true;S.statsError=null;render();
  try{if(!S.connected)throw new Error('未连接');var r=await api('/api/reading-stats');if(r.ok&&r.stats){S.stats=r.stats;S.statsLoaded=true;S.statsError=null;}else{S.statsError=r.message||'获取统计失败';}}catch(e){S.statsError=e.message;}
  S.statsLoading=false;render();
  if(S.connected && !S.timeline) {
    S.timelineLoading=true;render();
    try{var tr=await api('/api/timeline');if(tr.ok)S.timeline=tr.events||[]}catch(e){}
    S.timelineLoading=false;
  }
}
async function loadGroupNames(){
  try{var gnr=await api('/api/group-names');if(gnr.ok)S.groupNames=Object.assign({0:'默认',1:'追更',2:'养肥',16:'待分类'},gnr.names||{})}catch(e){}
}
async function loadPortrait(){
  // 先尝试读缓存（不传 force）
  S.portraitLoading=true;S.portrait=null;render();
  try{var r=await api('/api/portrait');S.portrait=r;}catch(e){S.portrait={ok:false,message:e.message};}
  S.portraitLoading=false;render();
}
async function checkLogin(){
  try{
    var r=await api('/api/login-status');
    if(r.logged){S.connected=true;S.url=r.serviceUrl||S.url;S.shelfLoading=true;render();
  try{var sr=await api('/api/shelf');if(sr.ok){S.books=sr.books||[];S.shelfError=null;}else{S.shelfError=sr.message||'获取书架失败';}}catch(e){S.shelfError=e.message;}
  S.shelfLoading=false;render();
    }else{S.error=r.message||r.hint||'';if(r.serviceUrl)S.url=r.serviceUrl;}
  }catch(e){S.error=e.message;}
  render();
}

// ---- 笔记 ----
function notesHtml() {
  if(!S.connected) return '<div class="cd"><div class="ch">📝 笔记</div><div class="cb"><div class="em">请先连接</div></div></div>';
  if(S.notesLoading) return '<div class="cd"><div class="ch">📝 笔记</div><div class="cb"><div class="em"><span class="sp"></span> 加载笔记...</div></div></div>';
  var html='<div class="cd"><div class="ch">📝 笔记 ('+S.notesList.length+')</div><div class="cb">';
  if(S.notesList.length===0) {
    html+='<div class="em">暂无笔记，试试点「刷新」</div>';
  } else {
    var byBook={};
    for(var i=0;i<S.notesList.length;i++) {
      var n=S.notesList[i];
      var key=n.bookName||'未知';
      if(!byBook[key]) byBook[key]=[];
      byBook[key].push(n);
    }
    for(var bookName in byBook) {
      var notes=byBook[bookName];
      html+='<div class="fl" style="border-bottom:1px solid var(--line-soft)"><div style="font-weight:600;font-size:14px;margin-bottom:6px">📖 '+esc(bookName)+' <span style="font-weight:400;color:var(--slate);font-size:12px">'+notes.length+' 条</span></div>';
      for(var j=0;j<Math.min(notes.length,5);j++) {
        html+='<div style="padding:6px 0;border-bottom:1px solid var(--line-soft);font-size:13px;font-family:var(--font-book);line-height:1.6">';
        if(notes[j].chapterName) html+='<span style="font-size:11px;color:var(--slate)">'+esc(notes[j].chapterName)+'</span><br>';
        html+=esc((notes[j].content||'').slice(0,200))+'</div>';
      }
      if(notes.length>5) html+='<div style="font-size:12px;color:var(--slate);padding:4px 0">还有 '+(notes.length-5)+' 条…</div>';
      html+='</div>';
    }
  }
  html+='</div></div><div style="display:flex;gap:8px;padding:0 18px 16px;flex-wrap:wrap"><button class="bp" data-act="notebk">🔄 刷新</button><button class="bo" data-act="exportbk">📥 导出 Markdown</button></div>';
  return html;
}

async function loadNotes(force){
  if(!S.connected)return;
  S.notesLoading=true;render();
  try{var r=await api('/api/notes-timeline?limit=100');if(r.ok)S.notesList=r.notes||[];else S.notesList=[];}catch(e){S.notesList=[];}
  S.notesLoading=false;render();
}

async function doExportNotes(){
  if(!S.connected){toast('请先连接','error');return}
  toast('正在导出…');
  try{
    var r=await api('/api/notes-export',{method:'POST',body:JSON.stringify({writeToObsidian:true})});
    if(r.ok&&r.filePath) toast('已导出到 Obsidian: '+r.filePath,'success');
    else if(r.ok&&r.markdown) toast('已生成 '+r.count+' 条笔记','success');
    else toast('导出失败: '+(r.message||'未知'),'error');
  }catch(e){toast('导出失败: '+e.message,'error');}
}