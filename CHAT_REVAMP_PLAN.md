# 🔥 ChatRoom — Full Revamp Plan
> Hand this file to your IDE agent. Complete feature spec with exact code patterns, Firebase paths, and implementation order.

---

## 📁 Final File Structure

```
project/
├── index.html        ← Full rewrite (same Firebase config, same data paths)
├── style.css         ← Extracted & redesigned
├── app.js            ← Extracted & extended
└── README.md
```

> All new code reads from the **same Firebase paths** your current app uses (`chatrooms/{roomId}/messages`, `members`, `typing`). Zero data loss.

---

## 🔒 Step 0 — Fix Firebase Rules First (CRITICAL)

Go to Firebase Console → Realtime Database → Rules. Paste this and click **Publish**:

```json
{
  "rules": {
    "chatrooms": {
      "$roomId": {
        "messages": {
          ".read": true,
          ".write": true
        },
        "members": {
          ".read": true,
          ".write": true
        },
        "typing": {
          ".read": true,
          ".write": true
        },
        "readReceipts": {
          ".read": true,
          ".write": true
        }
      }
    }
  }
}
```

This is permanent — no 30-day expiry like Test Mode.

---

## 🎨 Step 1 — Visual Redesign

### Design Direction
**Theme:** Obsidian glass — near-black background, electric indigo primary, micro-blur panels, smooth spring animations. Think Linear.app meets iMessage.

### New Google Fonts (replace in `<head>`):
```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet"/>
```

### New CSS Variables (replace `:root`):
```css
:root {
  --bg: #080810;
  --surface: #0f0f1a;
  --surface2: #16162a;
  --surface3: #1e1e32;
  --border: rgba(255,255,255,0.07);
  --border-bright: rgba(255,255,255,0.14);
  --text: #f0f0fa;
  --text-2: #9090b0;
  --text-3: #50507a;
  --accent: #6366f1;
  --accent-light: #818cf8;
  --accent-glow: rgba(99,102,241,0.22);
  --green: #22d3a5;
  --red: #f87171;
  --orange: #fb923c;
  --blue-tick: #60a5fa;
  --radius: 14px;
  --radius-lg: 20px;
  --radius-msg: 18px;
  --shadow: 0 24px 80px rgba(0,0,0,0.6);
  --font: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', monospace;
  --transition: 0.2s cubic-bezier(0.16,1,0.3,1);
}
```

### Layout Changes:
- Chat window: centered card, max-width 700px, height 94vh, `border-radius: var(--radius-lg)`
- Header: glassmorphism `backdrop-filter: blur(20px)`, sticky top
- Messages area: smooth scroll, larger padding `24px 20px`
- Input bar: pill-shaped input, rounded send button, image upload icon button

---

## 💬 Step 2 — Preserve Existing Data (ZERO CHANGES TO PATHS)

Your current Firebase structure:
```
chatrooms/
  {roomId}/
    messages/     ← keep exactly as-is, just add new fields to new messages
    members/      ← keep exactly as-is
    typing/       ← keep exactly as-is
    readReceipts/ ← NEW path (add alongside existing)
```

### Existing message object shape (don't change):
```javascript
{
  type: "msg" | "system",
  text: "...",
  sender: "Name",
  uid: "abc123",
  color: "#7c6aff",
  ts: 1234567890
}
```

### New message object shape (add optional fields):
```javascript
{
  type: "msg" | "system" | "image",   // added "image"
  text: "...",
  sender: "Name",
  uid: "abc123",
  color: "#7c6aff",
  ts: 1234567890,
  unsent: false,          // NEW — boolean flag
  imageUrl: null,         // NEW — base64 or storage URL
  imageThumb: null,       // NEW — tiny placeholder
  replyTo: null,          // NEW — { msgId, sender, text }
  reactions: {},          // NEW — { "👍": ["uid1","uid2"] }
}
```

Old messages without these fields render fine — all new fields are optional with fallback handling.

---

## ✅ Step 3 — Read Receipts & Blue Ticks

### How it works:
- When a user opens the room, they write their `userId` + `ts` to `readReceipts/{roomId}/{userId}/{messageId}`
- Actually simpler: write the **last-read message timestamp** per user
- To show "read by all", compare each member's lastReadTs against the message's `ts`

### Firebase path:
```
chatrooms/{roomId}/readReceipts/{userId}  →  { lastReadTs: 1234567890, name: "Alice" }
```

### JS — Update read position:
```javascript
// Call this whenever messages are scrolled into view or chat is focused
function updateReadReceipt() {
  if (!roomId || !userId) return;
  set(ref(db, `chatrooms/${roomId}/readReceipts/${userId}`), {
    lastReadTs: Date.now(),
    name: myName
  });
}

// Call on: window focus, chat opened, new message received
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) updateReadReceipt();
});
window.addEventListener('focus', updateReadReceipt);
```

### JS — Listen to receipts:
```javascript
let readReceipts = {}; // { userId: { lastReadTs, name } }

onValue(ref(db, `chatrooms/${roomId}/readReceipts`), snap => {
  readReceipts = snap.val() || {};
  // Re-render tick indicators on existing messages
  refreshTicks();
});
```

### JS — Compute tick status for a message:
```javascript
function getTickStatus(msg) {
  if (msg.uid !== userId) return null; // Only show ticks on your own messages
  if (msg.type !== 'msg') return null;

  const members = Object.keys(currentMembers); // all online member userIds
  const otherMembers = members.filter(id => id !== userId);
  
  if (otherMembers.length === 0) return 'sent'; // alone in room

  const readByAll = otherMembers.every(id => 
    readReceipts[id] && readReceipts[id].lastReadTs >= msg.ts
  );
  const readBySome = otherMembers.some(id => 
    readReceipts[id] && readReceipts[id].lastReadTs >= msg.ts
  );

  if (readByAll) return 'read';       // blue double tick
  if (readBySome) return 'delivered'; // grey double tick
  return 'sent';                      // single grey tick
}
```

### HTML — Tick icons (add inside `.msg-time` for own messages):
```html
<!-- Append this inside msg-time div for own messages -->
<span class="tick-icon" data-msgid="${msg.ts}">
  <!-- 'sent' -->    ✓
  <!-- 'delivered' --> ✓✓  (grey)
  <!-- 'read' -->    ✓✓  (blue, class: tick-read)
</span>
```

### CSS:
```css
.tick-icon { font-size: 0.7rem; margin-left: 4px; color: var(--text-3); }
.tick-icon.tick-read { color: var(--blue-tick); }

/* Tooltip on hover — shows who read it */
.tick-wrapper { position: relative; display: inline-flex; align-items: center; }
.tick-tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: var(--surface3);
  border: 1px solid var(--border-bright);
  border-radius: 10px;
  padding: 6px 10px;
  font-size: 0.72rem;
  color: var(--text-2);
  white-space: nowrap;
  z-index: 10;
  box-shadow: var(--shadow);
}
.tick-wrapper:hover .tick-tooltip { display: block; }
```

### Tooltip content:
```javascript
// Generate tooltip text like "Read by Alice, Bob"
function getReadTooltip(msg) {
  const readers = Object.entries(readReceipts)
    .filter(([id, r]) => id !== userId && r.lastReadTs >= msg.ts)
    .map(([, r]) => r.name);
  return readers.length ? 'Read by ' + readers.join(', ') : 'Sent';
}
```

---

## 🚫 Step 4 — Unsend Message

### How it works:
- Long-press (mobile) or right-click (desktop) on your own message → context menu appears
- "Unsend" sets `unsent: true` on the message in Firebase
- All clients render unsent messages as *"This message was unsent"* in italic grey
- Original text is deleted from Firebase (not just hidden)

### Firebase update:
```javascript
async function unsendMessage(msgKey) {
  // Replace message content with unsent placeholder
  await set(ref(db, `chatrooms/${roomId}/messages/${msgKey}`), {
    type: 'msg',
    text: '',
    unsent: true,
    sender: myName,
    uid: userId,
    color: myColor,
    ts: originalTs, // keep original timestamp
  });
}
```

### Render unsent messages:
```javascript
if (msg.unsent) {
  bubble.textContent = 'This message was unsent';
  bubble.classList.add('msg-unsent');
  // Don't show context menu on unsent messages
  return;
}
```

### CSS:
```css
.msg-unsent {
  font-style: italic;
  color: var(--text-3) !important;
  background: var(--surface2) !important;
  border: 1px dashed var(--border-bright);
}
```

### Context Menu HTML (add to body):
```html
<div id="ctxMenu" class="ctx-menu" style="display:none">
  <button class="ctx-item ctx-unsend" id="ctxUnsend">🗑 Unsend</button>
  <button class="ctx-item ctx-reply" id="ctxReply">↩ Reply</button>
  <button class="ctx-item ctx-react" id="ctxReact">😊 React</button>
  <div class="ctx-emoji-row" id="ctxEmojiRow" style="display:none">
    👍 ❤️ 😂 😮 😢 🔥
  </div>
</div>
```

### Context Menu CSS:
```css
.ctx-menu {
  position: fixed;
  background: var(--surface2);
  border: 1px solid var(--border-bright);
  border-radius: var(--radius);
  padding: 6px;
  z-index: 1000;
  box-shadow: var(--shadow);
  min-width: 160px;
  animation: ctxIn 0.15s ease;
}
@keyframes ctxIn {
  from { opacity:0; transform:scale(0.92) translateY(4px); }
  to   { opacity:1; transform:scale(1) translateY(0); }
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 0.88rem;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.ctx-item:hover { background: var(--surface3); }
.ctx-unsend { color: var(--red); }
.ctx-emoji-row {
  display: flex;
  gap: 4px;
  padding: 6px 12px;
  font-size: 1.3rem;
  cursor: pointer;
}
.ctx-emoji-row span:hover { transform: scale(1.3); }
```

### Context Menu JS:
```javascript
let ctxTarget = null; // { msgKey, msg }

// Attach to each message bubble
function attachContextMenu(bubbleEl, msgKey, msg) {
  if (msg.uid !== userId) {
    // Others' messages: only reply + react
    bubbleEl.addEventListener('contextmenu', e => showCtx(e, msgKey, msg, false));
    bubbleEl.addEventListener('touchstart', longPressHandler(e => showCtx(e, msgKey, msg, false)));
  } else {
    // Own messages: all options
    bubbleEl.addEventListener('contextmenu', e => showCtx(e, msgKey, msg, true));
    bubbleEl.addEventListener('touchstart', longPressHandler(e => showCtx(e, msgKey, msg, true)));
  }
}

function showCtx(e, msgKey, msg, isOwn) {
  e.preventDefault();
  ctxTarget = { msgKey, msg };
  const menu = document.getElementById('ctxMenu');
  document.getElementById('ctxUnsend').style.display = isOwn && !msg.unsent ? '' : 'none';
  menu.style.display = 'block';
  // Position near cursor/touch
  const x = Math.min(e.clientX || e.touches[0].clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY || e.touches[0].clientY, window.innerHeight - 160);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

document.addEventListener('click', () => {
  document.getElementById('ctxMenu').style.display = 'none';
});

document.getElementById('ctxUnsend').onclick = () => {
  if (ctxTarget) unsendMessage(ctxTarget.msgKey);
};

// Long press helper for mobile
function longPressHandler(cb) {
  let timer;
  return function(e) {
    timer = setTimeout(() => cb(e), 500);
    const cancel = () => clearTimeout(timer);
    e.target.addEventListener('touchend', cancel, { once: true });
    e.target.addEventListener('touchmove', cancel, { once: true });
  };
}
```

> **Important for agent:** To get the Firebase message key (needed for unsend), store it in a `data-key` attribute on each message row during render. When using `onValue`, iterate with `snap.forEach(child => { const key = child.key; const msg = child.val(); })` instead of `Object.values()`.

---

## 📷 Step 5 — Image Upload (Free, No Storage Needed)

### Strategy: Base64 in Realtime Database
- Firebase Realtime Database free tier allows **1GB storage**
- A compressed chat image is ~30–80KB as base64
- This is plenty for a private 2-person chat
- **No Firebase Storage needed** — stays 100% free forever

### JS — Image upload handler:
```javascript
// Add an image button next to the send button in HTML:
// <input type="file" id="imgUpload" accept="image/*" style="display:none"/>
// <button class="img-btn" onclick="document.getElementById('imgUpload').click()">🖼</button>

document.getElementById('imgUpload').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) return alert('Image must be under 3MB');
  
  // Show upload preview / loading state
  showUploadPreview(file);
  
  // Compress + convert to base64
  const base64 = await compressAndEncode(file, 800, 0.75);
  
  // Push to Firebase
  push(ref(db, `chatrooms/${roomId}/messages`), {
    type: 'image',
    text: '',
    imageUrl: base64,
    sender: myName,
    uid: userId,
    color: myColor,
    ts: Date.now()
  });
  
  e.target.value = ''; // reset input
});

// Compress image using canvas
function compressAndEncode(file, maxWidth, quality) {
  return new Promise(resolve => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = ev => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
```

### Render image messages:
```javascript
if (msg.type === 'image' && msg.imageUrl) {
  bubble.innerHTML = ''; // clear text content
  const imgEl = document.createElement('img');
  imgEl.src = msg.imageUrl;
  imgEl.className = 'chat-img';
  imgEl.onclick = () => openLightbox(msg.imageUrl);
  bubble.appendChild(imgEl);
  bubble.classList.add('msg-bubble-img');
}
```

### CSS:
```css
.chat-img {
  max-width: 240px;
  max-height: 280px;
  border-radius: 12px;
  display: block;
  cursor: zoom-in;
  transition: opacity 0.2s;
}
.chat-img:hover { opacity: 0.88; }
.msg-bubble-img { padding: 4px !important; background: transparent !important; }

/* Lightbox */
#lightbox {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.88);
  z-index: 2000;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  backdrop-filter: blur(8px);
}
#lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 12px; }
```

### JS lightbox:
```javascript
function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  lb.querySelector('img').src = src;
  lb.style.display = 'flex';
}
document.getElementById('lightbox').onclick = () => {
  document.getElementById('lightbox').style.display = 'none';
};
```

Add to body: `<div id="lightbox"><img/></div>`

### Image upload button CSS:
```css
.img-btn {
  width: 42px; height: 42px;
  background: var(--surface3);
  border: 1px solid var(--border-bright);
  border-radius: 50%;
  color: var(--text-2);
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background var(--transition);
}
.img-btn:hover { background: var(--surface2); color: var(--accent-light); }
```

---

## ↩️ Step 6 — Reply to Message

### How it works:
- Right-click / long-press → "Reply" in context menu
- A reply preview bar appears above the input
- Sent message stores `replyTo: { sender, text, ts }` 
- Messages with replyTo show a quote block above the bubble

### Reply bar HTML (add above `.input-bar`):
```html
<div id="replyBar" style="display:none" class="reply-bar">
  <div class="reply-preview">
    <div class="reply-line"></div>
    <div class="reply-content">
      <span class="reply-sender" id="replySender"></span>
      <span class="reply-text" id="replyText"></span>
    </div>
  </div>
  <button class="reply-close" onclick="cancelReply()">✕</button>
</div>
```

### Reply bar CSS:
```css
.reply-bar {
  padding: 8px 16px;
  background: var(--surface2);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  animation: slideUp 0.2s ease;
}
@keyframes slideUp {
  from { transform: translateY(8px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
.reply-preview { display: flex; align-items: center; gap: 10px; overflow: hidden; }
.reply-line { width: 3px; height: 36px; background: var(--accent); border-radius: 3px; flex-shrink: 0; }
.reply-content { overflow: hidden; }
.reply-sender { font-size: 0.78rem; font-weight: 600; color: var(--accent-light); display: block; }
.reply-text { font-size: 0.8rem; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.reply-close { background: none; border: none; color: var(--text-3); cursor: pointer; font-size: 1rem; flex-shrink: 0; }

/* Quote block inside message bubble */
.msg-quote {
  background: rgba(255,255,255,0.05);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  font-size: 0.78rem;
}
.msg-quote-sender { font-weight: 600; color: var(--accent-light); margin-bottom: 2px; }
.msg-quote-text { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

### Reply JS:
```javascript
let replyingTo = null; // { msgKey, sender, text, ts }

function startReply(msgKey, msg) {
  replyingTo = { msgKey, sender: msg.sender, text: msg.text || '📷 Image', ts: msg.ts };
  document.getElementById('replySender').textContent = msg.sender;
  document.getElementById('replyText').textContent = msg.text || '📷 Image';
  document.getElementById('replyBar').style.display = 'flex';
  document.getElementById('msgInput').focus();
}

function cancelReply() {
  replyingTo = null;
  document.getElementById('replyBar').style.display = 'none';
}

// In sendMessage(), attach replyTo if set:
push(ref(db, `chatrooms/${roomId}/messages`), {
  type: 'msg',
  text,
  sender: myName,
  uid: userId,
  color: myColor,
  ts: Date.now(),
  replyTo: replyingTo || null,   // <-- add this
});
cancelReply(); // clear after send
```

### Render quote in message:
```javascript
if (msg.replyTo) {
  const quote = document.createElement('div');
  quote.className = 'msg-quote';
  quote.innerHTML = `
    <div class="msg-quote-sender">${msg.replyTo.sender}</div>
    <div class="msg-quote-text">${msg.replyTo.text}</div>
  `;
  wrap.insertBefore(quote, bubble);
}
```

---

## 😊 Step 7 — Emoji Reactions

### Firebase path:
```
chatrooms/{roomId}/messages/{msgKey}/reactions/{emoji} → ["uid1", "uid2"]
```

### JS — Toggle reaction:
```javascript
async function toggleReaction(msgKey, emoji) {
  const path = `chatrooms/${roomId}/messages/${msgKey}/reactions/${encodeEmoji(emoji)}`;
  const snap = await get(ref(db, path));
  const users = snap.val() || [];
  const idx = users.indexOf(userId);
  if (idx === -1) users.push(userId);
  else users.splice(idx, 1);
  await set(ref(db, path), users.length ? users : null);
}

// emoji key must be safe for Firebase: encode it
function encodeEmoji(e) { return encodeURIComponent(e); }
```

### Render reactions below bubble:
```javascript
if (msg.reactions) {
  const reactionRow = document.createElement('div');
  reactionRow.className = 'reaction-row';
  Object.entries(msg.reactions).forEach(([enc, users]) => {
    const emoji = decodeURIComponent(enc);
    const btn = document.createElement('button');
    btn.className = 'reaction-pill' + (users.includes(userId) ? ' reacted' : '');
    btn.textContent = `${emoji} ${users.length}`;
    btn.title = 'Reacted by ' + users.map(id => members[id]?.name || 'Someone').join(', ');
    btn.onclick = () => toggleReaction(msgKey, emoji);
    reactionRow.appendChild(btn);
  });
  wrap.appendChild(reactionRow);
}
```

### CSS:
```css
.reaction-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.reaction-pill {
  padding: 2px 8px;
  background: var(--surface3);
  border: 1px solid var(--border-bright);
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background var(--transition);
  color: var(--text);
  font-family: var(--font);
}
.reaction-pill:hover { background: var(--surface2); }
.reaction-pill.reacted { background: var(--accent-glow); border-color: var(--accent); color: var(--accent-light); }
```

---

## 🔔 Step 8 — Browser Notifications (Turn on when tab is hidden)

```javascript
// Request permission when user joins
async function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

// Call when a new message arrives and tab is hidden
function notifyIfHidden(msg) {
  if (!document.hidden) return;
  if (msg.uid === userId) return;
  if (Notification.permission !== 'granted') return;
  new Notification(`${msg.sender} in #${roomId}`, {
    body: msg.type === 'image' ? '📷 Sent an image' : msg.text,
    icon: '💬',
    tag: 'chatroom-msg',
  });
}
```

---

## 🕐 Step 9 — Message Search

### Search bar HTML (add to chat header, hidden by default):
```html
<button id="btnSearch" class="icon-btn" title="Search">🔍</button>
<div id="searchBar" class="search-bar" style="display:none">
  <input id="searchInput" type="text" placeholder="Search messages..." 
    oninput="searchMessages(this.value)"/>
  <button onclick="closeSearch()">✕</button>
</div>
```

### JS:
```javascript
function searchMessages(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.msg-row').forEach(row => {
    const text = row.querySelector('.msg-bubble')?.textContent?.toLowerCase() || '';
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}
```

---

## 📋 Step 10 — Full Implementation Checklist for IDE Agent

Work through this in order — don't skip steps:

### Phase 1: Setup
- [ ] Update Firebase Rules (Step 0 above)
- [ ] Create `style.css` — extract all `<style>` from current `index.html`
- [ ] Create `app.js` — extract all `<script>` from current `index.html`
- [ ] Update `index.html` to link `style.css` and `app.js`
- [ ] Change font imports to Geist + Geist Mono
- [ ] Update `:root` CSS variables

### Phase 2: Data migration safety
- [ ] Change `listenMessages()` to use `snap.forEach(child => { const key = child.key; const msg = child.val() })` instead of `Object.values(snap.val())` — **this is needed so you have the Firebase key for unsend/reactions**
- [ ] Store `key` as `data-key="${key}"` attribute on each `.msg-row` element
- [ ] Add null/undefined guards for all new optional message fields (`msg.replyTo || null`, `msg.reactions || {}`, `msg.unsent || false`, `msg.imageUrl || null`)

### Phase 3: Read Receipts & Ticks
- [ ] Add `readReceipts` listener in `joinChat()`
- [ ] Call `updateReadReceipt()` on: join, window focus, visibility change, each new message received
- [ ] Implement `getTickStatus(msg)` function
- [ ] Add tick HTML inside `.msg-time` for own messages only
- [ ] Add hover tooltip showing names of who read it
- [ ] Add `currentMembers` object kept in sync with `listenMembers()`

### Phase 4: Context Menu
- [ ] Add `#ctxMenu` HTML to body
- [ ] Attach `contextmenu` + long-press handlers to every message bubble in `renderMsg()`
- [ ] Implement `showCtx()`, hide on document click
- [ ] Wire up Unsend button → `unsendMessage(msgKey)`
- [ ] Wire up Reply button → `startReply(msgKey, msg)`
- [ ] Wire up React button → show emoji row in context menu

### Phase 5: Unsend
- [ ] Implement `unsendMessage(msgKey)` using Firebase `set()` (not `remove()`)
- [ ] In `renderMsg()`, check `if (msg.unsent)` and render placeholder
- [ ] Hide context menu for unsent messages
- [ ] Only show Unsend option for own non-unsent messages

### Phase 6: Reply
- [ ] Add `#replyBar` HTML above `.input-bar`
- [ ] Implement `startReply()` and `cancelReply()`
- [ ] Modify `sendMessage()` to include `replyTo` field
- [ ] In `renderMsg()`, render `.msg-quote` block if `msg.replyTo` exists
- [ ] Auto-cancel reply after sending

### Phase 7: Image Upload
- [ ] Add file input + image button to `.input-bar`
- [ ] Implement `compressAndEncode()` using canvas
- [ ] Handle `type: 'image'` in `renderMsg()`
- [ ] Add lightbox HTML + JS
- [ ] Add 3MB size guard with user-friendly error

### Phase 8: Emoji Reactions
- [ ] Wire emoji clicks in context menu to `toggleReaction(msgKey, emoji)`
- [ ] In `renderMsg()`, render `.reaction-row` if `msg.reactions` exists
- [ ] Re-render reactions when Firebase `messages` updates (already handled by `onValue`)

### Phase 9: Polish
- [ ] Add browser notification permission request on join
- [ ] Call `notifyIfHidden(msg)` for each new message in `listenMessages()`
- [ ] Add search bar + `searchMessages()` function
- [ ] Smooth scroll to bottom only if user was already at bottom (existing logic is fine)
- [ ] Add keyboard shortcut: `Escape` → close context menu / cancel reply / close search

---

## ⚠️ Key Notes for IDE Agent

1. **Never use `Object.values(snap.val())`** for messages — use `snap.forEach()` to get the key
2. **Emoji keys in Firebase** must be encoded: `encodeURIComponent('👍')` → `%F0%9F%91%8D`. Decode when displaying
3. **Base64 images** can be large — add a loading spinner while image loads in the chat
4. **Read receipts** should only update when `roomId` and `userId` are set (after joining)
5. **Don't remove old messages** — `unsendMessage` uses `set()` to overwrite, not `remove()`
6. **The Firebase config** is already in the existing `app.js` — don't change it
7. **Old messages** without `replyTo`, `reactions`, `unsent`, `imageUrl` will render fine — all rendering code must check `if (msg.field)` before using

---

## 💾 Firebase Free Tier — Will This Stay Free?

| Feature | Firebase Usage | Free Limit | Your Usage (2-person chat) |
|---|---|---|---|
| Messages + reactions | Realtime DB storage | 1 GB | < 10 MB |
| Images (base64) | Realtime DB storage | 1 GB | ~50KB per image |
| Read receipts | Realtime DB writes | 100K/day | < 1K/day |
| Connections | Simultaneous | 100 | 2 |

✅ **All features stay within the free Spark plan forever for a private 2-person chat.**
