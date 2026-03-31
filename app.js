import { prepare, layout } from './pretext/layout.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, orderBy, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE.appspot.com",
  messagingSenderId: "REPLACE",
  appId: "REPLACE"
};

const fbApp = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);
let currentUser = null;
onAuthStateChanged(auth, u => { currentUser = u; });

let allPostsFlat = null;
let searchTimeout = null;

const postList    = document.getElementById('post-list');
const postView    = document.getElementById('post-view');
const pagination  = document.getElementById('pagination');
const progressBar = document.getElementById('progress-bar');

window.showHome      = showHome;
window.openPost      = openPost;
window.onSearch      = onSearch;
window.filterTag     = filterTag;
window.doSignIn      = doSignIn;
window.doSignOut     = doSignOut;
window.submitComment = submitComment;

showHome();

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
  return new Date(d).toLocaleDateString('cs-CZ', { day:'numeric', month:'long', year:'numeric' });
}
function readTime(c) {
  return Math.max(1, Math.round(c.replace(/<[^>]+>/g,'').split(/\s+/).length / 200)) + ' min čtení';
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
}

function renderMagazine(posts) {
  const hero = posts[0], grid = posts.slice(1, 7);
  postList.innerHTML = `
    <div class="magazine fade-in">
      <div class="hero-post" onclick="openPost(${hero.id})">
        <div class="hero-label">nejnovější</div>
        <h2 class="hero-title">${hero.title}</h2>
        <div class="hero-meta">${fmt(hero.published)}${hero.snippet ? ' — ' + hero.snippet.slice(0,120) + '…' : ''}</div>
        ${hero.tags.length ? `<div class="post-tags">${hero.tags.slice(0,4).map(t=>`<span class="tag" onclick="event.stopPropagation();filterTag('${t}')">${t}</span>`).join('')}</div>` : ''}
      </div>
      <div class="grid-posts">
        ${grid.map(p=>`
          <div class="grid-post" onclick="openPost(${p.id})">
            <div class="grid-post-date">${fmt(p.published)}</div>
            <div class="grid-post-title">${p.title}</div>
            ${p.snippet ? `<div class="grid-post-snippet">${p.snippet.slice(0,90)}…</div>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function renderList(posts, page) {
  postList.innerHTML = `
    <div class="list-header fade-in"><span class="list-page-label">strana ${page}</span></div>
    <div class="fade-in">
      ${posts.map(p=>`
        <div class="post-item" onclick="openPost(${p.id})">
          <div class="post-title">${p.title}</div>
          <div class="post-date">${fmt(p.published)}</div>
          ${p.snippet ? `<div class="post-snippet">${p.snippet}</div>` : ''}
          ${p.tags.length ? `<div class="post-tags">${p.tags.slice(0,5).map(t=>`<span class="tag" onclick="event.stopPropagation();filterTag('${t}')">${t}</span>`).join('')}</div>` : ''}
        </div>`).join('')}
    </div>`;
}

function renderPagination(cur, meta) {
  const total = meta.pages;
  const pages = new Set([0]);
  for (let i = Math.max(0, cur-2); i <= Math.min(total-1, cur+2); i++) pages.add(i);
  pages.add(total-1);
  const sorted = [...pages].sort((a,b)=>a-b);
  let html = '', prev = -1;
  for (const p of sorted) {
    if (p - prev > 1) html += `<span class="page-ellipsis">…</span>`;
    html += `<button class="page-btn ${p===cur?'active':''}" onclick="showHome(${p})">${p}</button>`;
    prev = p;
  }
  pagination.innerHTML = html;
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
      <span class="back-btn" onclick="showHome()">← zpět</span>
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
}

// ── Real Pretext layout ──
// Uses prepare() + layout() to measure how tall text will be beside an image,
// so images are sized to match their adjacent text block precisely.
function renderWithPretext(htmlContent, container) {
  const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
  const images = [...doc.body.querySelectorAll('img')];
  images.forEach(img => img.remove());

  // No images — plain render
  if (!images.length) { container.innerHTML = doc.body.innerHTML; return; }

  const blocks = [...doc.body.childNodes].filter(n =>
    n.nodeType === 1 ? n.textContent.trim() : n.textContent.trim()
  );

  const containerWidth = container.closest('#post-view')?.offsetWidth || 680;
  const IMG_W   = Math.floor(containerWidth * 0.40);
  const GAP     = 20;
  const TEXT_W  = containerWidth - IMG_W - GAP;
  const FONT    = '18px "Cormorant Garamond", Georgia, serif';
  const LINE_H  = 18 * 1.85;
  const GROUP   = 3; // paragraphs per image
  let imgIdx    = 0;

  // Walk blocks in groups, pairing with images
  for (let g = 0; g < blocks.length; g += GROUP) {
    const group = blocks.slice(g, g + GROUP);
    const img   = images[imgIdx];

    if (img) {
      imgIdx++;

      // Measure combined text height with Pretext
      const combinedText = group.map(n => n.textContent || '').join(' ').trim();
      let textHeight = LINE_H * 4; // fallback
      if (combinedText) {
        const prepared = prepare(combinedText, FONT);
        const result   = layout(prepared, TEXT_W, LINE_H);
        textHeight     = result.height;
      }

      const imgH = Math.max(100, Math.min(Math.round(textHeight), 400));
      const dir  = (imgIdx % 2 === 0) ? 'right' : 'left';

      const section = document.createElement('div');
      section.className = 'pretext-section';
      section.style.cssText = `display:flex; flex-direction:${dir==='right'?'row-reverse':'row'}; gap:${GAP}px; margin-bottom:2em; align-items:flex-start;`;

      img.style.cssText = `width:${IMG_W}px; height:${imgH}px; object-fit:cover; flex-shrink:0; opacity:0.88; display:block;`;
      img.loading = 'lazy';

      const textDiv = document.createElement('div');
      textDiv.style.cssText = `flex:1; min-width:0;`;
      group.forEach(n => textDiv.appendChild(n.cloneNode(true)));

      section.appendChild(img);
      section.appendChild(textDiv);
      container.appendChild(section);
    } else {
      // Remaining blocks after images run out
      group.forEach(n => container.appendChild(n.cloneNode(true)));
    }
  }

  // Any leftover images
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
    const snap = await getDocs(query(collection(db,'comments'), where('postId','==',postId), orderBy('createdAt','asc')));
    snap.forEach(d => comments.push({id:d.id,...d.data()}));
  } catch(e) {}

  section.innerHTML = `
    <div class="comments-title">KOMENTÁŘE (${comments.length})</div>
    <div class="comment-list">
      ${!comments.length
        ? '<div class="no-comments">Zatím žádné komentáře.</div>'
        : comments.map(c=>`
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
  catch(e) { console.error(e); }
}
async function doSignOut() { await signOut(auth); location.reload(); }
async function submitComment(postId) {
  const text = document.getElementById('comment-text')?.value?.trim();
  if (!text || !currentUser) return;
  try { await addDoc(collection(db,'comments'), {postId, text, authorName:currentUser.displayName, authorPhoto:currentUser.photoURL, createdAt:serverTimestamp()}); loadComments(postId); }
  catch(e) { console.error(e); }
}

// ── Search ──
function onSearch(val) {
  clearTimeout(searchTimeout);
  if (!val.trim()) { showHome(0); return; }
  searchTimeout = setTimeout(() => doSearch(val.trim().toLowerCase()), 300);
}

async function doSearch(q) {
  postView.classList.add('hidden');
  postList.classList.remove('hidden');
  pagination.innerHTML = '';
  postList.innerHTML = '<div class="loading">hledám</div>';
  if (!allPostsFlat) {
    const meta = await fetchJSON('data/meta.json');
    allPostsFlat = (await Promise.all(Array.from({length:meta.pages},(_,i)=>fetchJSON(`data/index_${i}.json`)))).flat();
  }
  const results = allPostsFlat.filter(p => p.title.toLowerCase().includes(q) || p.snippet.toLowerCase().includes(q) || p.tags.some(t=>t.toLowerCase().includes(q)));
  postList.innerHTML = !results.length
    ? `<div class="search-header">Žádné výsledky pro „${q}"</div>`
    : `<div class="search-header fade-in">Nalezeno ${results.length} příspěvků pro „${q}"</div>
       <div class="fade-in">${results.slice(0,50).map(p=>`<div class="post-item" onclick="openPost(${p.id})"><div class="post-title">${p.title}</div><div class="post-date">${fmt(p.published)}</div>${p.snippet?`<div class="post-snippet">${p.snippet}</div>`:''}</div>`).join('')}</div>`;
}

async function filterTag(tag) {
  postView.classList.add('hidden');
  postList.classList.remove('hidden');
  pagination.innerHTML = '';
  postList.innerHTML = '<div class="loading">filtruji</div>';
  if (!allPostsFlat) {
    const meta = await fetchJSON('data/meta.json');
    allPostsFlat = (await Promise.all(Array.from({length:meta.pages},(_,i)=>fetchJSON(`data/index_${i}.json`)))).flat();
  }
  const results = allPostsFlat.filter(p => p.tags.includes(tag));
  postList.innerHTML = `<div class="search-header fade-in">Štítek „${tag}" — ${results.length} příspěvků</div>
    <div class="fade-in">${results.map(p=>`<div class="post-item" onclick="openPost(${p.id})"><div class="post-title">${p.title}</div><div class="post-date">${fmt(p.published)}</div>${p.snippet?`<div class="post-snippet">${p.snippet}</div>`:''}</div>`).join('')}</div>`;
}
