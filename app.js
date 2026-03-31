import { prepare, layout } from './pretext/layout.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAnalytics, logEvent }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDjJKW_XmWE7ayzYQO8XSOx6XdtG1SDcr8",
  authDomain: "stuprumblog.firebaseapp.com",
  projectId: "stuprumblog",
  storageBucket: "stuprumblog.firebasestorage.app",
  messagingSenderId: "442612700149",
  appId: "1:442612700149:web:33720bb1d90c4b215186bc",
  measurementId: "G-EHTSGRHC3K"
};

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const analytics = getAnalytics(fbApp);

let currentUser = null;
onAuthStateChanged(auth, u => { currentUser = u; });

let allPostsFlat = null;
let fullSearchIndex = null;
let commentsMap = {};
let searchTimeout = null;

// Persistent navigation state
let navState = { type: 'home', page: 0 };

const postList = document.getElementById('post-list');
const postView = document.getElementById('post-view');
const pagination = document.getElementById('pagination');
const progressBar = document.getElementById('progress-bar');

window.showHome = (p) => { navState = { type: 'home', page: p || 0 }; showHome(p); };
window.openPost = openPost;
window.onSearch = onSearch;
window.filterTag = (t) => { navState = { type: 'tag', tag: t }; filterTag(t); };
window.doSignIn = doSignIn;
window.doSignOut = doSignOut;
window.submitComment = submitComment;
window.goBack = goBack;

// Initial load
(async () => {
  try {
    const comments = await fetchJSON('comments.json');
    comments.forEach(c => {
      commentsMap[c.postId] = (commentsMap[c.postId] || 0) + 1;
    });
  } catch (e) { console.warn('Could not load comments.json', e); }
  showHome();
})();

function goBack() {
  if (navState.type === 'home') showHome(navState.page);
  else if (navState.type === 'tag') filterTag(navState.tag);
  else if (navState.type === 'search') doSearch(navState.q);
  else showHome();
}

window.addEventListener('scroll', () => {
  if (!postView.classList.contains('hidden')) {
    const h = document.documentElement;
    progressBar.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight) * 100) + '%';
  } else {
    progressBar.style.width = '0%';
  }
});

function fmt(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
}
function readTime(c) {
  return Math.max(1, Math.round(c.replace(/<[^>]+>/g, '').split(/\s+/).length / 200)) + ' min čtení';
}
function getCommentBadge(filename) {
  const count = commentsMap[filename] || 0;
  return count > 0 ? `<div class="post-comment-count">Komentáře: ${count}</div>` : '';
}
async function fetchJSON(url) { return (await fetch(url)).json(); }

// ── Home ──
async function showHome(page = 0) {
  postView.classList.add('hidden');
  postList.classList.remove('hidden');
  postList.innerHTML = '<div class="loading">načítám</div>';
  pagination.innerHTML = '';
  window.scrollTo(0, 0);

  const [meta, posts] = await Promise.all([fetchJSON('data/meta.json'), fetchJSON(`data/index_${page}.json`)]);
  page === 0 ? renderMagazine(posts) : renderList(posts, page);
  renderPagination(page, meta);
  
  logEvent(analytics, 'page_view', { page_title: `Home - Page ${page}`, page_location: location.href, page_path: `/?p=${page}` });
  logEvent(analytics, 'screen_view', { firebase_screen: `Home - Page ${page}`, firebase_screen_class: 'HomeView' });
}

function renderMagazine(posts) {
  const hero = posts[0], grid = posts.slice(1, 7);
  postList.innerHTML = `
    <div class="magazine fade-in">
      <div class="hero-post" onclick="openPost(${hero.id})">
        <div class="hero-label">nejnovější</div>
        <h2 class="hero-title">${hero.title}</h2>
        <div class="hero-meta">${fmt(hero.published)}${hero.snippet ? ' — ' + hero.snippet.slice(0, 120) + '…' : ''}</div>
        ${getCommentBadge(hero.filename)}
        ${hero.tags.length ? `<div class="post-tags">${hero.tags.slice(0, 4).map(t => `<span class="tag" onclick="event.stopPropagation();filterTag('${t}')">${t}</span>`).join('')}</div>` : ''}
      </div>
      <div class="grid-posts">
        ${grid.map(p => `
          <div class="grid-post" onclick="openPost(${p.id})">
            <div class="grid-post-date">${fmt(p.published)}</div>
            <div class="grid-post-title">${p.title}</div>
            ${getCommentBadge(p.filename)}
            ${p.snippet ? `<div class="grid-post-snippet">${p.snippet.slice(0, 90)}…</div>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function renderList(posts, page) {
  postList.innerHTML = `
    <div class="list-header fade-in"><span class="list-page-label">strana ${page}</span></div>
    <div class="fade-in">
      ${posts.map(p => `
        <div class="post-item" onclick="openPost(${p.id})">
          <div class="post-title">${p.title}</div>
          <div class="post-date">${fmt(p.published)}</div>
          ${getCommentBadge(p.filename)}
          ${p.snippet ? `<div class="post-snippet">${p.snippet}</div>` : ''}
          ${p.tags.length ? `<div class="post-tags">${p.tags.slice(0, 5).map(t => `<span class="tag" onclick="event.stopPropagation();filterTag('${t}')">${t}</span>`).join('')}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderPagination(current, meta) {
  if (meta.pages <= 1) return;
  const btns = [];
  const range = 2;
  const addBtn = (i, label, active = false) => {
    btns.push(`<button class="page-btn ${active ? 'active' : ''}" onclick="showHome(${i})">${label || i}</button>`);
  };
  if (current > 0) addBtn(current - 1, '←');
  for (let i = 0; i < meta.pages; i++) {
    if (i === 0 || i === meta.pages - 1 || (i >= current - range && i <= current + range)) {
      addBtn(i, i, i === current);
    } else if (i === current - range - 1 || i === current + range + 1) {
      btns.push('<span class="page-ellipsis">…</span>');
    }
  }
  if (current < meta.pages - 1) addBtn(current + 1, '→');
  pagination.innerHTML = btns.join('');
}

// ── Post view ──
async function openPost(id) {
  postList.classList.add('hidden');
  pagination.innerHTML = '';
  postView.classList.remove('hidden');
  postView.innerHTML = '<div class="loading">načítám</div>';
  window.scrollTo(0, 0);

  const post = await fetchJSON(`data/post_${id}.json`);

  postView.innerHTML = `
    <div class="fade-in">
      <span class="back-btn" onclick="goBack()">← zpět</span>
      <div class="post-header">
        <h1 class="post-full-title">${post.title}</h1>
        <div class="post-meta">
          <span>${fmt(post.published)}</span>
          ${post.content ? `<span>${readTime(post.content)}</span>` : ''}
          ${post.tags.length ? `<span>${post.tags.join(', ')}</span>` : ''}
        </div>
      </div>
      <div class="post-content" id="post-content-body"></div>
      <div class="comments-section" id="comments-section"><div class="loading">načítám komentáře</div></div>
    </div>`;

  const el = document.getElementById('post-content-body');
  post.content ? renderWithPretext(post.content, el) : (el.innerHTML = '<p class="empty-post">Tento příspěvek nemá obsah.</p>');
  loadComments(post.filename || String(id));
  
  logEvent(analytics, 'page_view', { page_title: post.title, page_location: location.href, page_path: post.filename });
  logEvent(analytics, 'screen_view', { firebase_screen: post.title, firebase_screen_class: 'PostView' });
}

// ── Real Pretext layout ──
function renderWithPretext(htmlContent, container) {
  const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
  const images = [...doc.body.querySelectorAll('img')];
  images.forEach(img => img.remove());
  if (!images.length) { container.innerHTML = doc.body.innerHTML; return; }
  const blocks = [...doc.body.childNodes].filter(n => n.nodeType === 1 ? n.textContent.trim() : n.textContent.trim());
  const containerWidth = container.closest('#post-view')?.offsetWidth || 680;
  const IMG_W = Math.floor(containerWidth * 0.40);
  const GAP = 20;
  const TEXT_W = containerWidth - IMG_W - GAP;
  const FONT = '24px "Cormorant Garamond", Georgia, serif';
  const LINE_H = 24 * 1.9;
  const GROUP = 3;
  let imgIdx = 0;
  for (let g = 0; g < blocks.length; g += GROUP) {
    const group = blocks.slice(g, g + GROUP);
    const img = images[imgIdx];
    if (img) {
      imgIdx++;
      const combinedText = group.map(n => n.textContent || '').join(' ').trim();
      let textHeight = LINE_H * 4;
      if (combinedText) {
        const prepared = prepare(combinedText, FONT);
        const result = layout(prepared, TEXT_W, LINE_H);
        textHeight = result.height;
      }
      const imgH = Math.max(100, Math.min(Math.round(textHeight), 400));
      const dir = (imgIdx % 2 === 0) ? 'right' : 'left';
      const section = document.createElement('div');
      section.className = 'pretext-section';
      section.style.cssText = `display:flex; flex-direction:${dir === 'right' ? 'row-reverse' : 'row'}; gap:${GAP}px; margin-bottom:2em; align-items:flex-start;`;
      img.style.cssText = `width:${IMG_W}px; height:${imgH}px; object-fit:cover; flex-shrink:0; opacity:0.88; display:block;`;
      img.loading = 'lazy';
      const textDiv = document.createElement('div');
      textDiv.style.cssText = `flex:1; min-width:0;`;
      group.forEach(n => textDiv.appendChild(n.cloneNode(true)));
      section.appendChild(img);
      section.appendChild(textDiv);
      container.appendChild(section);
    } else {
      group.forEach(n => container.appendChild(n.cloneNode(true)));
    }
  }
  const remaining = images.slice(imgIdx);
  if (remaining.length) {
    const row = document.createElement('div');
    row.style.cssText = `display:flex; gap:8px; flex-wrap:wrap; margin:2em 0;`;
    remaining.forEach(img => {
      img.style.cssText = `flex:1; min-width:140px; max-width:100%; object-fit:cover; opacity:0.88;`;
      img.loading = 'lazy';
      row.appendChild(img);
    });
    container.appendChild(row);
  }
}

// ── Comments ──
async function loadComments(postId) {
  const section = document.getElementById('comments-section');
  if (!section) return;
  let comments = [];
  try {
    const snap = await getDocs(query(collection(db, 'comments'), where('postId', '==', postId), orderBy('createdAt', 'asc')));
    snap.forEach(d => comments.push({ id: d.id, ...d.data() }));
  } catch (e) { }
  section.innerHTML = `
    <div class="comments-title">KOMENTÁŘE (${comments.length})</div>
    <div class="comment-list">
      ${!comments.length
      ? '<div class="no-comments">Zatím žádné komentáře.</div>'
      : comments.map(c => `
          <div class="comment">
            <div class="comment-author">${c.authorName}<span class="comment-date">${c.createdAt?.toDate ? fmt(c.createdAt.toDate()) : ''}</span></div>
            <div class="comment-text">${c.text}</div>
          </div>`).join('')}
    </div>
    <div class="comment-form" id="comment-form">${renderCommentForm(postId)}</div>`;
}

function renderCommentForm(postId) {
  return currentUser ? `
    <div class="signed-as">Přihlášen/a jako <span>${currentUser.displayName}</span>
      <button class="sign-out-btn" onclick="doSignOut()">odhlásit</button>
    </div>
    <textarea class="comment-textarea" id="comment-text" placeholder="Napište komentář…"></textarea>
    <button class="submit-btn" onclick="submitComment('${postId}')">Odeslat</button>`
    : `<button class="google-btn" onclick="doSignIn('${postId}')">Přihlásit přes Google a komentovat</button>`;
}

async function doSignIn(postId) {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); document.getElementById('comment-form').innerHTML = renderCommentForm(postId); }
  catch (e) { console.error(e); }
}
async function doSignOut() { await signOut(auth); location.reload(); }
async function submitComment(postId) {
  const text = document.getElementById('comment-text')?.value?.trim();
  if (!text || !currentUser) return;
  try { await addDoc(collection(db, 'comments'), { postId, text, authorName: currentUser.displayName, authorPhoto: currentUser.photoURL, createdAt: serverTimestamp() }); loadComments(postId); }
  catch (e) { console.error(e); }
}

// ── Search & Tag ──
function onSearch(val) {
  clearTimeout(searchTimeout);
  if (!val.trim()) { showHome(0); return; }
  searchTimeout = setTimeout(() => {
    navState = { type: 'search', q: val.trim().toLowerCase() };
    doSearch(navState.q);
  }, 300);
}

async function doSearch(q) {
  postView.classList.add('hidden');
  postList.classList.remove('hidden');
  pagination.innerHTML = '';
  postList.innerHTML = '<div class="loading">prohledávám celé texty</div>';
  if (!fullSearchIndex) fullSearchIndex = await fetchJSON('data/search.json');
  const queries = q.toLowerCase().split(/\s+/).filter(x => x.length > 0);
  const results = fullSearchIndex.filter(p => {
    const text = (p.title + ' ' + (p.tags||[]).join(' ') + ' ' + p.text).toLowerCase();
    return queries.every(word => text.includes(word));
  });
  postList.innerHTML = !results.length
    ? `<div class="search-header">Žádné výsledky pro „${q}"</div>`
    : `<div class="search-header fade-in">Nalezeno ${results.length} příspěvků pro „${q}"</div>
       <div class="fade-in search-results-container">
         ${results.slice(0, 100).map(p => `
           <div class="post-item" onclick="openPost(${p.id})">
             <div class="post-title">${p.title}</div>
             <div class="post-date">${p.published ? fmt(p.published) : 'ID: ' + p.id}</div>
             ${getCommentBadge(p.filename)}
             <div class="post-snippet">${getSearchSnippet(p.text, queries)}</div>
           </div>`).join('')}
       </div>`;
  logEvent(analytics, 'search', { search_term: q });
  logEvent(analytics, 'page_view', { page_title: `Search: ${q}`, page_location: location.href, page_path: `/?q=${q}` });
  logEvent(analytics, 'screen_view', { firebase_screen: `Search: ${q}`, firebase_screen_class: 'SearchView' });
}

function getSearchSnippet(text, queries) {
  if (!text) return '';
  const firstWord = queries[0] || '';
  const idx = text.indexOf(firstWord);
  if (idx === -1) return text.slice(0, 160) + '...';
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + 120);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet += '...';
  queries.forEach(q => {
    const re = new RegExp(`(${q})`, 'gi');
    snippet = snippet.replace(re, '<span class="search-highlight">$1</span>');
  });
  return snippet;
}

async function filterTag(tag) {
  postView.classList.add('hidden');
  postList.classList.remove('hidden');
  pagination.innerHTML = '';
  postList.innerHTML = '<div class="loading">filtruji</div>';
  if (!allPostsFlat) {
    const meta = await fetchJSON('data/meta.json');
    allPostsFlat = (await Promise.all(Array.from({ length: meta.pages }, (_, i) => fetchJSON(`data/index_${i}.json`)))).flat();
  }
  const results = allPostsFlat.filter(p => p.tags.includes(tag));
  postList.innerHTML = `<div class="search-header fade-in">Štítek „${tag}" — ${results.length} příspěvků</div>
    <div class="fade-in">${results.map(p => `
      <div class="post-item" onclick="openPost(${p.id})">
        <div class="post-title">${p.title}</div>
        <div class="post-date">${fmt(p.published)}</div>
        ${getCommentBadge(p.filename)}
        ${p.snippet ? `<div class="post-snippet">${p.snippet}</div>` : ''}
      </div>`).join('')}</div>`;
  logEvent(analytics, 'select_content', { content_type: 'tag', item_id: tag });
  logEvent(analytics, 'page_view', { page_title: `Tag: ${tag}`, page_location: location.href, page_path: `/?tag=${tag}` });
  logEvent(analytics, 'screen_view', { firebase_screen: `Tag: ${tag}`, firebase_screen_class: 'TagView' });
}
