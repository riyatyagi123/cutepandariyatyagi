const $ = id => document.getElementById(id);

let currentUser = JSON.parse(localStorage.getItem('community_user') || 'null');

function setWhoami() {
  const elWho = $('whoami');
  if (currentUser && currentUser.username) elWho.textContent = `Signed in as ${currentUser.username}`;
  else elWho.textContent = '';
}
setWhoami();

async function api(path, opts) {
  try {
    const r = await fetch(path, opts);
    // try to parse JSON safely
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }

    if (!r.ok) {
      // If server returned JSON error object, pick it; otherwise return status+body
      if (data && data.error) return { error: data.error, details: data.details || text };
      return { error: `HTTP ${r.status} ${r.statusText}`, details: text };
    }
    return data;
  } catch (err) {
    // network-level error
    return { error: 'network-error', details: String(err) };
  }
}


// Register
$('registerBtn').addEventListener('click', async () => {
  const username = $('username').value.trim();
  const password = $('password').value.trim();
  if (!username || !password) return alert('username and password required');
  const j = await api('/api/community/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password})});
  if (j.error) return alert('Error: '+j.error);
  alert('Registered — now login');
});

// Login
$('loginBtn').addEventListener('click', async () => {
  const username = $('username').value.trim();
  const password = $('password').value.trim();
  if (!username || !password) return alert('username and password required');
  const j = await api('/api/community/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password})});
  if (j.error) return alert('Login failed: '+j.error);
  currentUser = {user_id: j.user_id, username: j.username};
  localStorage.setItem('community_user', JSON.stringify(currentUser));
  setWhoami();
  loadPosts();
});

// Create post (optimistic UI)
$('createPostBtn').addEventListener('click', async () => {
  const content = $('postContent').value.trim();
  if (!content) return alert('Write something first');
  const payload = { content };
  if (currentUser && currentUser.user_id) payload.user_id = currentUser.user_id;

  // disable to prevent accidental double-click
  $('createPostBtn').disabled = true;
  $('createPostBtn').textContent = 'Posting...';

  try {
    const j = await api('/api/community/posts', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if (j.error) { alert('Error: '+j.error); return; }
    // If server returned created post, prepend it
    if (j.post) {
      prependPost(j.post);
      $('postContent').value = '';
    } else {
      // fallback: reload the list
      await loadPosts();
      $('postContent').value = '';
    }
  } catch (err) {
    alert('Network error when creating post');
  } finally {
    $('createPostBtn').disabled = false;
    $('createPostBtn').textContent = 'Post';
  }
});

$('refreshBtn').addEventListener('click', loadPosts);

function prependPost(p) {
  const area = $('postsArea');
  const html = postHtml(p);
  // insert at top
  area.insertAdjacentHTML('afterbegin', html);
  attachCommentButtonToPost(p.id);
}

function postHtml(p) {
  const username = escapeHtml(p.username || 'Anonymous');
  const created = escapeHtml(p.created_at || '');
  const content = escapeHtml(p.content || '');
  const comment_count = p.comment_count || 0;
  return `
    <div class="post-card" id="post_${p.id}">
      <div class="post-header">
        <div><strong>${username}</strong></div>
        <div class="post-meta">${created}</div>
      </div>
      <div class="post-content">${content}</div>
      <div class="row" style="margin-top:10px;">
        <button class="commentBtn" data-id="${p.id}">Comments (${comment_count})</button>
      </div>
      <div class="comments" id="comments_${p.id}"></div>
    </div>
  `;
}

async function loadPosts() {
  const area = $('postsArea');
  area.innerHTML = '<div class="muted">Loading posts...</div>';
  try {
    const posts = await api('/api/community/posts');
    if (!Array.isArray(posts) || posts.length === 0) {
      area.innerHTML = '<p class="muted">No posts yet.</p>';
      return;
    }
    area.innerHTML = posts.map(p => postHtml(p)).join('');
    // attach comment buttons
    posts.forEach(p => attachCommentButtonToPost(p.id));
  } catch (err) {
    area.innerHTML = '<p class="muted">Failed to load posts.</p>';
  }
}

function attachCommentButtonToPost(id) {
  const btn = document.querySelector(`#post_${id} .commentBtn`);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const target = document.getElementById('comments_'+id);
    if (!target) return;
    // if empty -> render UI + load comments
    if (!target.dataset.loaded) {
      target.innerHTML = `
        <div style="margin-top:8px;"><textarea id="c_${id}" rows="2" placeholder="Write a supportive comment..."></textarea></div>
        <div class="row" style="margin-top:8px;"><button data-id="${id}" class="postCommentBtn">Post comment</button></div>
        <div id="list_${id}" style="margin-top:8px;"></div>
      `;
      target.dataset.loaded = "1";
      // load existing comments
      await loadComments(id);
      // attach handler
      target.querySelector('.postCommentBtn').addEventListener('click', async (ev) => {
        const pid = ev.currentTarget.dataset.id;
        const body = document.getElementById('c_'+pid).value.trim();
        if (!body) return alert('Write a comment');
        const payload = { content: body };
        if (currentUser && currentUser.user_id) payload.user_id = currentUser.user_id;
        ev.currentTarget.disabled = true;
        ev.currentTarget.textContent = 'Posting...';
        try {
          const j = await api(`/api/community/posts/${pid}/comments`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
          if (j.error) { alert('Error: '+j.error); return; }
          document.getElementById('c_'+pid).value = '';
          await loadComments(pid);
        } catch (err) {
          alert('Network error posting comment');
        } finally {
          ev.currentTarget.disabled = false;
          ev.currentTarget.textContent = 'Post comment';
        }
      });
    } else {
      // toggle
      target.style.display = (target.style.display === 'none') ? 'block' : 'none';
    }
  });
}

async function loadComments(pid) {
  const list = document.getElementById('list_'+pid);
  if (!list) return;
  list.innerHTML = 'Loading comments...';
  try {
    const j = await api(`/api/community/posts/${pid}/comments`);
    if (!Array.isArray(j) || j.length === 0) {
      list.innerHTML = '<div class="muted">No comments yet.</div>';
      return;
    }
    list.innerHTML = j.map(c => `<div class="comment-block"><strong>${escapeHtml(c.username||'Anon')}</strong> <div class="post-meta">${escapeHtml(c.created_at)}</div><div style="margin-top:6px;">${escapeHtml(c.content)}</div></div>`).join('');
  } catch (err) {
    list.innerHTML = '<div class="muted">Failed to load comments.</div>';
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

// initial load
loadPosts();
setWhoami();
