import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, set, remove, off, get }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCDQf-i8UH5wXc9Erz-clkrRi-byRbrwNE",
  authDomain: "multip-35e38.firebaseapp.com",
  databaseURL: "https://multip-35e38-default-rtdb.firebaseio.com",
  projectId: "multip-35e38",
  storageBucket: "multip-35e38.firebasestorage.app",
  messagingSenderId: "641663267611",
  appId: "1:641663267611:web:8c20f6b7a47657226e19be"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const COLORS = ["#7c6aff","#ff6b6b","#3dd68c","#ff9f43","#54a0ff","#fd79a8","#e17055","#00cec9","#a29bfe","#55efc4"];

let selectedColor = COLORS[0];
let myName, myColor, roomId, userId, presenceRef, typingRef, typingTimeout;
let readReceipts = {};
let currentMembers = {};
let replyingTo = null;
let ctxTarget = null;
let seenMessageKeys = null;
let skipNotifyForNextMessagesSnapshot = true;
let messageByKey = new Map();

const colorRow = document.getElementById("colorRow");
COLORS.forEach((c, i) => {
  const btn = document.createElement("div");
  btn.className = "color-opt" + (i === 0 ? " selected" : "");
  btn.style.background = c;
  btn.onclick = () => {
    document.querySelectorAll(".color-opt").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedColor = c;
  };
  colorRow.appendChild(btn);
});

function encodeEmoji(e) {
  return encodeURIComponent(e);
}

function updateReadReceipt() {
  if (!roomId || !userId) return;
  set(ref(db, `chatrooms/${roomId}/readReceipts/${userId}`), {
    lastReadTs: Date.now(),
    name: myName
  });
}

function getTickStatus(msg) {
  if (msg.uid !== userId) return null;
  if (msg.type !== "msg" && msg.type !== "image") return null;
  if (msg.unsent) return null;

  const members = Object.keys(currentMembers);
  const otherMembers = members.filter(id => id !== userId);

  if (otherMembers.length === 0) return "sent";

  const readByAll = otherMembers.every(id =>
    readReceipts[id] && readReceipts[id].lastReadTs >= msg.ts
  );
  const readBySome = otherMembers.some(id =>
    readReceipts[id] && readReceipts[id].lastReadTs >= msg.ts
  );

  if (readByAll) return "read";
  if (readBySome) return "delivered";
  return "sent";
}

function getReadTooltip(msg) {
  const readers = Object.entries(readReceipts)
    .filter(([id, r]) => id !== userId && r.lastReadTs >= msg.ts)
    .map(([, r]) => r.name);
  return readers.length ? "Read by " + readers.join(", ") : "Sent";
}

function refreshTicks() {
  document.querySelectorAll(".msg-row[data-msgkey].me").forEach(row => {
    const key = row.dataset.msgkey;
    const msg = messageByKey.get(key);
    if (!msg || msg.uid !== userId) return;
    const wrapTick = row.querySelector(".tick-wrapper");
    if (!wrapTick) return;
    const tick = wrapTick.querySelector(".tick-icon");
    const tip = wrapTick.querySelector(".tick-tooltip");
    if (!tick) return;
    const status = getTickStatus(msg);
    if (!status) {
      tick.textContent = "";
      tick.className = "tick-icon";
      if (tip) tip.textContent = "";
      return;
    }
    tick.className = "tick-icon" + (status === "read" ? " tick-read" : status === "delivered" ? " tick-delivered" : "");
    tick.textContent = status === "sent" ? "✓" : "✓✓";
    if (tip) tip.textContent = getReadTooltip(msg);
  });
}

async function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch (_) { /* ignore */ }
  }
}

function notifyIfHidden(msg) {
  if (!document.hidden) return;
  if (msg.uid === userId) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = msg.type === "image" ? "📷 Sent an image"
    : msg.unsent ? "Message unsent"
    : (msg.text || "").slice(0, 120) || "New message";
  try {
    new Notification(`${msg.sender} in #${roomId}`, {
      body,
      tag: "chatroom-msg"
    });
  } catch (_) { /* ignore */ }
}

function hideCtxMenu() {
  const menu = document.getElementById("ctxMenu");
  if (menu) {
    menu.style.display = "none";
    const row = document.getElementById("ctxEmojiRow");
    if (row) row.classList.remove("is-open");
  }
  ctxTarget = null;
}

function longPressHandler(cb) {
  return function touchStartHandler(e) {
    const timer = setTimeout(() => cb(e), 500);
    const cancel = () => clearTimeout(timer);
    e.target.addEventListener("touchend", cancel, { once: true });
    e.target.addEventListener("touchmove", cancel, { once: true });
  };
}

function showCtx(e, msgKey, msg, isOwn) {
  e.preventDefault();
  if (msg.unsent) return;
  ctxTarget = { msgKey, msg };
  const menu = document.getElementById("ctxMenu");
  const unsendBtn = document.getElementById("ctxUnsend");
  const emojiRow = document.getElementById("ctxEmojiRow");
  if (emojiRow) emojiRow.classList.remove("is-open");

  if (unsendBtn) {
    unsendBtn.style.display = isOwn && !msg.unsent ? "" : "none";
  }
  menu.style.display = "block";
  const cx = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const cy = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
  const x = Math.min(cx, window.innerWidth - 180);
  const y = Math.min(cy, window.innerHeight - 200);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}

function attachContextMenu(bubbleEl, msgKey, msg) {
  const isOwn = msg.uid === userId;
  bubbleEl.addEventListener("contextmenu", (e) => showCtx(e, msgKey, msg, isOwn));
  bubbleEl.addEventListener("touchstart", longPressHandler((e) => showCtx(e, msgKey, msg, isOwn)));
}

async function unsendMessage(msgKey) {
  const msg = messageByKey.get(msgKey);
  if (!msg || msg.uid !== userId || !roomId) return;
  hideCtxMenu();
  await set(ref(db, `chatrooms/${roomId}/messages/${msgKey}`), {
    type: "msg",
    text: "",
    unsent: true,
    sender: myName,
    uid: userId,
    color: myColor,
    ts: msg.ts
  });
}

function startReply(msgKey, msg) {
  hideCtxMenu();
  const previewText = msg.type === "image" ? "📷 Image" : (msg.text || "");
  replyingTo = { msgKey, sender: msg.sender, text: previewText, ts: msg.ts };
  document.getElementById("replySender").textContent = msg.sender;
  document.getElementById("replyText").textContent = previewText;
  document.getElementById("replyBar").style.display = "flex";
  document.getElementById("msgInput").focus();
}

function cancelReply() {
  replyingTo = null;
  const bar = document.getElementById("replyBar");
  if (bar) bar.style.display = "none";
}

async function toggleReaction(msgKey, emoji) {
  if (!roomId) return;
  const path = `chatrooms/${roomId}/messages/${msgKey}/reactions/${encodeEmoji(emoji)}`;
  const snap = await get(ref(db, path));
  const users = Array.isArray(snap.val()) ? [...snap.val()] : [];
  const idx = users.indexOf(userId);
  if (idx === -1) users.push(userId);
  else users.splice(idx, 1);
  await set(ref(db, path), users.length ? users : null);
}

function compressAndEncode(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

function showUploadPreview(visible) {
  const el = document.getElementById("uploadPreview");
  if (!el) return;
  el.classList.toggle("is-visible", !!visible);
  el.textContent = visible ? "Compressing image…" : "";
}

function openLightbox(src) {
  const lb = document.getElementById("lightbox");
  if (!lb) return;
  lb.querySelector("img").src = src;
  lb.style.display = "flex";
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (lb) lb.style.display = "none";
}

function searchMessages(query) {
  const q = (query || "").trim().toLowerCase();
  document.querySelectorAll(".msg-row[data-msgkey]").forEach((row) => {
    const hay = (row.dataset.searchtext || "").toLowerCase();
    row.classList.toggle("msg-row-hidden", !!(q && !hay.includes(q)));
  });
}

function closeSearch() {
  const bar = document.getElementById("searchBar");
  const input = document.getElementById("searchInput");
  if (bar) bar.style.display = "none";
  if (input) {
    input.value = "";
    searchMessages("");
  }
}

let lastDay = "";

function renderMsg(msg, msgKey) {
  const el = document.getElementById("messages");
  const unsent = !!msg.unsent;
  const replyTo = msg.replyTo || null;
  const reactions = msg.reactions && typeof msg.reactions === "object" ? msg.reactions : null;

  const d = new Date(msg.ts);
  const dayStr = d.toDateString();

  if (dayStr !== lastDay) {
    lastDay = dayStr;
    const div = document.createElement("div");
    div.className = "date-div";
    const now = new Date();
    div.textContent = d.toDateString() === now.toDateString()
      ? "Today"
      : d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    el.appendChild(div);
  }

  if (msg.type === "system") {
    const div = document.createElement("div");
    div.className = "msg-system";
    div.textContent = msg.text;
    el.appendChild(div);
    return;
  }

  const isMe = msg.uid === userId;
  const row = document.createElement("div");
  row.className = "msg-row " + (isMe ? "me" : "them");
  row.dataset.msgkey = msgKey;

  let searchText = (msg.text || "").trim();
  if (msg.type === "image") searchText = (searchText ? searchText + " " : "") + "image photo picture";
  if (unsent) searchText = "unsent message";
  row.dataset.searchtext = searchText;

  const av = document.createElement("div");
  av.className = "msg-av";
  av.style.background = msg.color || "#7c6aff";
  av.textContent = (msg.sender || "?")[0].toUpperCase();

  const wrap = document.createElement("div");
  wrap.className = "msg-wrap";

  if (replyTo) {
    const quote = document.createElement("div");
    quote.className = "msg-quote";
    const qSender = document.createElement("div");
    qSender.className = "msg-quote-sender";
    qSender.textContent = replyTo.sender || "";
    const qText = document.createElement("div");
    qText.className = "msg-quote-text";
    qText.textContent = replyTo.text || "";
    quote.appendChild(qSender);
    quote.appendChild(qText);
    wrap.appendChild(quote);
  }

  if (!isMe) {
    const sn = document.createElement("div");
    sn.className = "msg-sender";
    sn.textContent = msg.sender;
    sn.style.color = msg.color || "var(--text-2)";
    wrap.appendChild(sn);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (unsent) {
    bubble.textContent = "This message was unsent";
    bubble.classList.add("msg-unsent");
  } else if (msg.type === "image" && msg.imageUrl) {
    bubble.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "chat-img-loading";
    loading.textContent = "⏳";
    bubble.appendChild(loading);
    const imgEl = document.createElement("img");
    imgEl.className = "chat-img";
    imgEl.alt = "Chat image";
    imgEl.onload = () => {
      loading.remove();
    };
    imgEl.onerror = () => {
      loading.textContent = "⚠️";
    };
    imgEl.src = msg.imageUrl;
    imgEl.onclick = () => openLightbox(msg.imageUrl);
    bubble.appendChild(imgEl);
    bubble.classList.add("msg-bubble-img");
  } else {
    bubble.textContent = msg.text || "";
  }

  if (!unsent) {
    attachContextMenu(bubble, msgKey, msg);
  }

  const time = document.createElement("div");
  time.className = "msg-time";
  time.appendChild(document.createTextNode(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));

  if (isMe && !unsent && (msg.type === "msg" || msg.type === "image")) {
    const tickWrap = document.createElement("span");
    tickWrap.className = "tick-wrapper";
    const tick = document.createElement("span");
    tick.className = "tick-icon";
    const status = getTickStatus(msg);
    if (status) {
      tick.className = "tick-icon" + (status === "read" ? " tick-read" : status === "delivered" ? " tick-delivered" : "");
      tick.textContent = status === "sent" ? "✓" : "✓✓";
    }
    const tip = document.createElement("span");
    tip.className = "tick-tooltip";
    tip.textContent = status ? getReadTooltip(msg) : "";
    tickWrap.appendChild(tick);
    tickWrap.appendChild(tip);
    time.appendChild(tickWrap);
  }

  wrap.appendChild(bubble);
  wrap.appendChild(time);

  if (reactions && Object.keys(reactions).length) {
    const reactionRow = document.createElement("div");
    reactionRow.className = "reaction-row";
    Object.entries(reactions).forEach(([enc, users]) => {
      if (!Array.isArray(users) || !users.length) return;
      const emoji = decodeURIComponent(enc);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "reaction-pill" + (users.includes(userId) ? " reacted" : "");
      btn.textContent = `${emoji} ${users.length}`;
      const names = users.map((id) => currentMembers[id]?.name || "Someone").join(", ");
      btn.title = "Reacted by " + names;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        toggleReaction(msgKey, emoji);
      };
      reactionRow.appendChild(btn);
    });
    if (reactionRow.childNodes.length) wrap.appendChild(reactionRow);
  }

  if (isMe) {
    row.appendChild(wrap);
    row.appendChild(av);
  } else {
    row.appendChild(av);
    row.appendChild(wrap);
  }

  el.appendChild(row);
}

function listenMembers() {
  onValue(ref(db, `chatrooms/${roomId}/members`), (snap) => {
    const data = snap.val() || {};
    currentMembers = data;
    const list = Object.values(data);
    document.getElementById("onlineCount").textContent = list.length + " online";
    const strip = document.getElementById("membersStrip");
    strip.innerHTML = "";
    list.forEach((m) => {
      const chip = document.createElement("div");
      chip.className = "member-chip";
      const av = document.createElement("div");
      av.className = "av";
      av.style.background = m.color;
      av.textContent = m.name[0].toUpperCase();
      chip.appendChild(av);
      chip.appendChild(document.createTextNode(m.name === myName ? m.name + " (you)" : m.name));
      strip.appendChild(chip);
    });
    refreshTicks();
  });
}

function listenReadReceipts() {
  onValue(ref(db, `chatrooms/${roomId}/readReceipts`), (snap) => {
    readReceipts = snap.val() || {};
    refreshTicks();
  });
}

function listenMessages() {
  onValue(ref(db, `chatrooms/${roomId}/messages`), (snap) => {
    const el = document.getElementById("messages");
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;

    const entries = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        entries.push({ key: child.key, val: child.val() });
      });
    }
    entries.sort((a, b) => (a.val.ts || 0) - (b.val.ts || 0));

    if (seenMessageKeys) {
      if (skipNotifyForNextMessagesSnapshot) {
        entries.forEach((e) => seenMessageKeys.add(e.key));
        if (snap.exists()) {
          skipNotifyForNextMessagesSnapshot = false;
        }
      } else {
        entries.forEach((e) => {
          if (!seenMessageKeys.has(e.key)) {
            seenMessageKeys.add(e.key);
            const msg = e.val;
            if (msg && msg.uid !== userId && (msg.type === "msg" || msg.type === "image")) {
              notifyIfHidden(msg);
            }
          }
        });
      }
    }

    messageByKey = new Map(entries.map((e) => [e.key, e.val]));
    el.innerHTML = "";
    lastDay = "";
    entries.forEach((e) => renderMsg(e.val, e.key));

    if (atBottom) el.scrollTop = el.scrollHeight;
    updateReadReceipt();
    refreshTicks();

    const q = document.getElementById("searchInput")?.value;
    if (q) searchMessages(q);
  });
}

function listenTyping() {
  onValue(ref(db, `chatrooms/${roomId}/typing`), (snap) => {
    const data = snap.val() || {};
    const others = Object.entries(data).filter(([id]) => id !== userId).map(([, v]) => v.name);
    const bar = document.getElementById("typingBar");
    if (!others.length) bar.textContent = "";
    else if (others.length === 1) bar.textContent = others[0] + " is typing...";
    else bar.textContent = others.join(", ") + " are typing...";
  });
}

window.joinChat = function () {
  myName = document.getElementById("nameInput").value.trim();
  roomId = document.getElementById("roomInput").value.trim().replace(/\s+/g, "-").toLowerCase();
  myColor = selectedColor;
  if (!myName) return alert("Enter your name!");
  if (!roomId) return alert("Enter a room ID!");

  userId = Math.random().toString(36).slice(2, 9);

  document.getElementById("joinScreen").style.display = "none";
  const cs = document.getElementById("chatScreen");
  cs.style.display = "flex";
  document.getElementById("headerRoom").textContent = "# " + roomId;

  seenMessageKeys = new Set();
  skipNotifyForNextMessagesSnapshot = true;

  presenceRef = ref(db, `chatrooms/${roomId}/members/${userId}`);
  set(presenceRef, { name: myName, color: myColor });

  typingRef = ref(db, `chatrooms/${roomId}/typing/${userId}`);

  push(ref(db, `chatrooms/${roomId}/messages`), { type: "system", text: `${myName} joined`, ts: Date.now() });

  requestNotifPermission();

  listenMembers();
  listenReadReceipts();
  listenMessages();
  listenTyping();

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onWinFocus);
  document.addEventListener("keydown", onGlobalKeydown);

  setTimeout(() => document.getElementById("msgInput").focus(), 100);
  updateReadReceipt();
};

function onVisibility() {
  if (!document.hidden) updateReadReceipt();
}

function onWinFocus() {
  updateReadReceipt();
}

function onGlobalKeydown(e) {
  if (e.key !== "Escape") return;
  hideCtxMenu();
  cancelReply();
  closeSearch();
}

window.sendMessage = function () {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  clearTypingState();

  const payload = {
    type: "msg",
    text,
    sender: myName,
    uid: userId,
    color: myColor,
    ts: Date.now(),
    replyTo: replyingTo
      ? { sender: replyingTo.sender, text: replyingTo.text, ts: replyingTo.ts }
      : null
  };
  cancelReply();
  push(ref(db, `chatrooms/${roomId}/messages`), payload);
};

window.onTyping = function () {
  set(typingRef, { name: myName, ts: Date.now() });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTypingState, 2500);
};

function clearTypingState() {
  clearTimeout(typingTimeout);
  remove(typingRef);
}

window.leaveChat = function () {
  push(ref(db, `chatrooms/${roomId}/messages`), { type: "system", text: `${myName} left`, ts: Date.now() });
  clearTypingState();
  remove(presenceRef);
  remove(ref(db, `chatrooms/${roomId}/readReceipts/${userId}`));

  off(ref(db, `chatrooms/${roomId}/messages`));
  off(ref(db, `chatrooms/${roomId}/members`));
  off(ref(db, `chatrooms/${roomId}/typing`));
  off(ref(db, `chatrooms/${roomId}/readReceipts`));

  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("focus", onWinFocus);
  document.removeEventListener("keydown", onGlobalKeydown);

  document.getElementById("chatScreen").style.display = "none";
  document.getElementById("joinScreen").style.display = "block";
  document.getElementById("messages").innerHTML = "";
  hideCtxMenu();
  cancelReply();
  closeSearch();
  seenMessageKeys = null;
  skipNotifyForNextMessagesSnapshot = true;
  readReceipts = {};
  currentMembers = {};
  messageByKey.clear();
};

/* Context menu wiring */
document.addEventListener("click", (e) => {
  const menu = document.getElementById("ctxMenu");
  if (!menu || menu.style.display !== "block") return;
  if (!menu.contains(e.target)) hideCtxMenu();
});

const ctxMenuEl = document.getElementById("ctxMenu");
if (ctxMenuEl) {
  ctxMenuEl.addEventListener("click", (e) => e.stopPropagation());
}

document.getElementById("ctxUnsend")?.addEventListener("click", () => {
  if (ctxTarget) unsendMessage(ctxTarget.msgKey);
});

document.getElementById("ctxReply")?.addEventListener("click", () => {
  if (ctxTarget) startReply(ctxTarget.msgKey, ctxTarget.msg);
});

document.getElementById("ctxReact")?.addEventListener("click", () => {
  const row = document.getElementById("ctxEmojiRow");
  if (row) row.classList.toggle("is-open");
});

document.querySelectorAll("#ctxEmojiRow span[data-emoji]").forEach((span) => {
  span.addEventListener("click", () => {
    const emoji = span.getAttribute("data-emoji");
    if (ctxTarget && emoji) {
      toggleReaction(ctxTarget.msgKey, emoji);
      hideCtxMenu();
    }
  });
});

window.cancelReply = cancelReply;

document.getElementById("lightbox")?.addEventListener("click", closeLightbox);

document.getElementById("imgUpload")?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !roomId) return;
  if (file.size > 3 * 1024 * 1024) {
    alert("Image must be under 3MB");
    e.target.value = "";
    return;
  }
  showUploadPreview(true);
  try {
    const base64 = await compressAndEncode(file, 800, 0.75);
    push(ref(db, `chatrooms/${roomId}/messages`), {
      type: "image",
      text: "",
      imageUrl: base64,
      sender: myName,
      uid: userId,
      color: myColor,
      ts: Date.now()
    });
  } catch (err) {
    alert("Could not process image.");
  } finally {
    showUploadPreview(false);
    e.target.value = "";
  }
});

document.getElementById("btnSearch")?.addEventListener("click", () => {
  const bar = document.getElementById("searchBar");
  if (!bar) return;
  const show = bar.style.display === "none" || !bar.style.display;
  bar.style.display = show ? "flex" : "none";
  if (show) {
    document.getElementById("searchInput")?.focus();
  } else {
    closeSearch();
  }
});

window.searchMessages = searchMessages;
window.closeSearch = closeSearch;
