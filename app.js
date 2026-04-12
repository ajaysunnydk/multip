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

// ── Persistent identity ──
const STORAGE_KEY = "chatroom_identity";
const RECENT_ROOMS_KEY = "chatroom_recent_rooms";

function loadIdentity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveIdentity(identity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

function hashPin(pin) {
  return btoa("chatroom_" + pin + "_salt");
}

function newUserId() {
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dmIdFor(userA, userB) {
  return [userA, userB].sort().join("_");
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

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

let currentChatMode = "room";
let currentDMOtherUser = null;
let activeChatBase = "";
let chatGlobalsBound = false;
let dmListUnsub = null;

function showScreen(id) {
  ["authScreen", "homeScreen", "chatScreen"].forEach((sid) => {
    const el = document.getElementById(sid);
    if (el) el.style.display = "none";
  });
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = "flex";
  el.style.flexDirection = "column";
  if (id === "authScreen") {
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
  } else if (id === "homeScreen") {
    el.style.alignItems = "center";
    el.style.justifyContent = "flex-start";
  } else if (id === "chatScreen") {
    el.style.alignItems = "stretch";
  }
}

function buildColorRow() {
  const colorRow = document.getElementById("colorRow");
  if (!colorRow || colorRow.childElementCount) return;
  COLORS.forEach((c, i) => {
    const btn = document.createElement("div");
    btn.className = "color-opt" + (i === 0 ? " selected" : "");
    btn.style.background = c;
    btn.dataset.color = c;
    btn.onclick = () => {
      document.querySelectorAll("#colorRow .color-opt").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedColor = c;
    };
    colorRow.appendChild(btn);
  });
}

function syncColorPickerUI(color) {
  if (!color || !COLORS.includes(color)) return;
  selectedColor = color;
  document.querySelectorAll("#colorRow .color-opt").forEach((b) => {
    b.classList.toggle("selected", b.dataset.color === color);
  });
}

window.togglePinVisibility = function () {
  const input = document.getElementById("authPin");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
};

function showAuthError(msg) {
  const el = document.getElementById("authError");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

function clearAuthError() {
  const el = document.getElementById("authError");
  if (el) el.style.display = "none";
}

window.handleAuth = async function () {
  clearAuthError();
  const name = document.getElementById("authName")?.value.trim() || "";
  const pin = document.getElementById("authPin")?.value.trim() || "";
  if (!name) return showAuthError("Enter your name");
  if (!pin || pin.length < 4) return showAuthError("PIN must be at least 4 digits");
  if (pin.length > 8) return showAuthError("PIN must be at most 8 digits");
  if (!/^\d+$/.test(pin)) return showAuthError("PIN must be numbers only");

  const btn = document.getElementById("authBtn");
  btn.textContent = "Loading…";
  btn.disabled = true;

  try {
    const usersSnap = await get(ref(db, "users"));
    let foundUserId = null;
    let foundUser = null;
    if (usersSnap.exists()) {
      usersSnap.forEach((child) => {
        if (child.val().name?.toLowerCase() === name.toLowerCase()) {
          foundUserId = child.key;
          foundUser = child.val();
        }
      });
    }

    if (foundUser) {
      if (foundUser.pin !== hashPin(pin)) {
        showAuthError("Wrong PIN for this name");
        return;
      }
      userId = foundUserId;
      myName = foundUser.name;
      myColor = foundUser.color || COLORS[0];
      selectedColor = myColor;
      syncColorPickerUI(myColor);
    } else {
      userId = newUserId();
      myName = name;
      myColor = selectedColor;
      const letter = myName[0]?.toUpperCase() || "?";
      await set(ref(db, `users/${userId}`), {
        name: myName,
        color: myColor,
        pin: hashPin(pin),
        createdAt: Date.now(),
        lastSeen: Date.now(),
        avatar: letter
      });
    }

    await set(ref(db, `users/${userId}/lastSeen`), Date.now());
    saveIdentity({ userId, name: myName, color: myColor });

    showScreen("homeScreen");
    loadHomeScreen();
  } catch (err) {
    showAuthError("Something went wrong. Try again.");
    console.error(err);
  } finally {
    btn.textContent = "Continue →";
    btn.disabled = false;
  }
};

window.logOut = function () {
  if (!confirm("Log out? You can log back in with your name + PIN.")) return;
  clearIdentity();
  if (dmListUnsub) {
    dmListUnsub();
    dmListUnsub = null;
  }
  myName = "";
  myColor = "";
  userId = null;
  document.getElementById("authName").value = "";
  document.getElementById("authPin").value = "";
  clearAuthError();
  showScreen("authScreen");
};

function getRecentRooms() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ROOMS_KEY) || "[]");
  } catch {
    return [];
  }
}

function addRecentRoom(rid) {
  const rooms = getRecentRooms().filter((r) => r.id !== rid);
  rooms.unshift({ id: rid, ts: Date.now() });
  localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms.slice(0, 20)));
}

function renderRecentRooms() {
  const list = document.getElementById("recentRoomsList");
  const rooms = getRecentRooms();
  if (!rooms.length) {
    list.innerHTML = '<div class="chat-list-empty">No recent rooms yet</div>';
    return;
  }
  list.innerHTML = "";
  rooms.forEach((r) => {
    const item = document.createElement("div");
    item.className = "chat-list-item";
    item.innerHTML = `
      <div class="cli-avatar room-avatar-icon">🏠</div>
      <div class="cli-body">
        <div class="cli-name"># ${escapeHtml(r.id)}</div>
        <div class="cli-preview">Tap to open</div>
      </div>
      <div class="cli-meta">
        <div class="cli-time">${timeAgo(r.ts)}</div>
      </div>
    `;
    item.onclick = () => enterRoom(r.id);
    list.appendChild(item);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function loadHomeScreen() {
  const av = document.getElementById("homeAvatar");
  if (av) {
    av.textContent = myName[0].toUpperCase();
    av.style.background = myColor;
  }
  document.getElementById("homeName").textContent = myName;
  set(ref(db, `users/${userId}/lastSeen`), Date.now()).catch(() => {});
  renderRecentRooms();
  listenDMList();
}

window.switchTab = function (tab) {
  document.getElementById("tabContentRooms").style.display = tab === "rooms" ? "" : "none";
  document.getElementById("tabContentDMs").style.display = tab === "dms" ? "" : "none";
  document.getElementById("tabRooms").classList.toggle("active", tab === "rooms");
  document.getElementById("tabDMs").classList.toggle("active", tab === "dms");
};

window.homeJoinRoom = function () {
  const input = document.getElementById("homeRoomInput");
  const id = input.value.trim().replace(/\s+/g, "-").toLowerCase();
  if (!id) return;
  input.value = "";
  enterRoom(id);
};

function enterRoom(rid) {
  roomId = rid;
  currentChatMode = "room";
  currentDMOtherUser = null;
  addRecentRoom(rid);
  openChatScreen();
}

function listenDMList() {
  if (dmListUnsub) {
    dmListUnsub();
    dmListUnsub = null;
  }
  const dmListEl = document.getElementById("dmList");
  dmListUnsub = onValue(ref(db, "dms"), (snap) => {
    const all = snap.val() || {};
    const mine = Object.entries(all)
      .filter(([, data]) => data?.meta?.participants && data.meta.participants[userId])
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => (b.meta?.lastMessage?.ts || 0) - (a.meta?.lastMessage?.ts || 0));

    if (!mine.length) {
      dmListEl.innerHTML = '<div class="chat-list-empty">No DMs yet</div>';
      return;
    }

    dmListEl.innerHTML = "";
    mine.forEach((dm) => {
      const participants = dm.meta?.participants || {};
      const other = Object.entries(participants).find(([id]) => id !== userId);
      if (!other) return;
      const [, otherData] = other;
      const unread = dm.meta?.unread?.[userId] || 0;
      const lastMsg = dm.meta?.lastMessage;

      const item = document.createElement("div");
      item.className = "chat-list-item";
      const preview = lastMsg
        ? (lastMsg.senderName === myName ? "You: " : "") + (lastMsg.text || "")
        : "No messages yet";
      const initial = (otherData.name || "?")[0].toUpperCase();
      item.innerHTML = `
        <div class="cli-avatar" style="background:${otherData.color || "#7c6aff"}">${initial}</div>
        <div class="cli-body">
          <div class="cli-name">${escapeHtml(otherData.name || "Someone")}</div>
          <div class="cli-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="cli-meta">
          ${lastMsg ? `<div class="cli-time">${timeAgo(lastMsg.ts)}</div>` : ""}
          ${unread > 0 ? `<div class="cli-unread">${unread > 9 ? "9+" : unread}</div>` : ""}
        </div>
      `;
      item.onclick = () => openDM(dm.id, other[0], otherData);
      dmListEl.appendChild(item);
    });
  });
}

window.startDM = async function () {
  const targetName = document.getElementById("dmTargetName").value.trim();
  if (!targetName) return;
  if (targetName.toLowerCase() === myName.toLowerCase()) {
    alert("You can't DM yourself.");
    return;
  }

  const snap = await get(ref(db, "users"));
  let targetId = null;
  let targetData = null;
  if (snap.exists()) {
    snap.forEach((child) => {
      if (child.val().name?.toLowerCase() === targetName.toLowerCase()) {
        targetId = child.key;
        targetData = child.val();
      }
    });
  }

  if (!targetId) {
    alert(`User "${targetName}" not found. They need to sign up once first.`);
    return;
  }

  document.getElementById("dmTargetName").value = "";

  const dmId = dmIdFor(userId, targetId);
  await set(ref(db, `dms/${dmId}/meta/participants/${userId}`), { name: myName, color: myColor });
  await set(ref(db, `dms/${dmId}/meta/participants/${targetId}`), {
    name: targetData.name,
    color: targetData.color || COLORS[0]
  });

  openDM(dmId, targetId, targetData);
};

function openDM(dmId, otherId, otherData) {
  roomId = dmId;
  currentChatMode = "dm";
  currentDMOtherUser = { id: otherId, ...otherData };
  set(ref(db, `dms/${dmId}/meta/unread/${userId}`), 0);
  openChatScreen();
}

function openChatScreen() {
  showScreen("chatScreen");
  activeChatBase = currentChatMode === "dm" ? `dms/${roomId}` : `chatrooms/${roomId}`;

  const headerRoom = document.getElementById("headerRoom");
  if (currentChatMode === "dm" && currentDMOtherUser) {
    headerRoom.textContent = "@ " + currentDMOtherUser.name;
  } else {
    headerRoom.textContent = "# " + roomId;
  }

  seenMessageKeys = new Set();
  skipNotifyForNextMessagesSnapshot = true;

  presenceRef = ref(db, `${activeChatBase}/members/${userId}`);
  set(presenceRef, { name: myName, color: myColor });
  typingRef = ref(db, `${activeChatBase}/typing/${userId}`);

  push(ref(db, `${activeChatBase}/messages`), {
    type: "system",
    text: `${myName} joined`,
    ts: Date.now()
  });

  requestNotifPermission();

  listenMembersAt(activeChatBase);
  listenReadReceiptsAt(activeChatBase);
  listenMessagesAt(activeChatBase);
  listenTypingAt(activeChatBase);

  if (!chatGlobalsBound) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWinFocus);
    document.addEventListener("keydown", onGlobalKeydown);
    chatGlobalsBound = true;
  }

  setTimeout(() => document.getElementById("msgInput").focus(), 100);
  updateReadReceiptAt(activeChatBase);
}

function listenMembersAt(base) {
  onValue(ref(db, `${base}/members`), (snap) => {
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
      av.textContent = (m.name || "?")[0].toUpperCase();
      chip.appendChild(av);
      chip.appendChild(document.createTextNode(m.name === myName ? m.name + " (you)" : m.name));
      strip.appendChild(chip);
    });
    refreshTicks();
  });
}

function listenReadReceiptsAt(base) {
  onValue(ref(db, `${base}/readReceipts`), (snap) => {
    readReceipts = snap.val() || {};
    refreshTicks();
  });
}

function listenMessagesAt(base) {
  onValue(ref(db, `${base}/messages`), (snap) => {
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
        if (snap.exists()) skipNotifyForNextMessagesSnapshot = false;
      } else {
        entries.forEach((e) => {
          if (!seenMessageKeys.has(e.key)) {
            seenMessageKeys.add(e.key);
            const msg = e.val;
            if (msg && msg.uid !== userId && (msg.type === "msg" || msg.type === "image")) {
              notifyIfHidden(msg);
            }
            if (currentChatMode === "dm" && msg && msg.type !== "system") {
              const preview = msg.type === "image" ? "📷 Photo" : (msg.text || "").slice(0, 60);
              set(ref(db, `dms/${roomId}/meta/lastMessage`), {
                text: preview,
                ts: msg.ts,
                senderName: msg.sender || ""
              });
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
    updateReadReceiptAt(base);
    refreshTicks();

    const q = document.getElementById("searchInput")?.value;
    if (q) searchMessages(q);
  });
}

function listenTypingAt(base) {
  onValue(ref(db, `${base}/typing`), (snap) => {
    const data = snap.val() || {};
    const others = Object.entries(data).filter(([id]) => id !== userId).map(([, v]) => v.name);
    const bar = document.getElementById("typingBar");
    if (!others.length) bar.textContent = "";
    else if (others.length === 1) bar.textContent = others[0] + " is typing…";
    else bar.textContent = others.join(", ") + " are typing…";
  });
}

function updateReadReceiptAt(base) {
  if (!roomId || !userId || !base) return;
  set(ref(db, `${base}/readReceipts/${userId}`), {
    lastReadTs: Date.now(),
    name: myName
  });
}

function bumpDmUnreadFor(recipientUid) {
  if (!recipientUid || currentChatMode !== "dm" || !roomId) return;
  get(ref(db, `dms/${roomId}/meta/unread/${recipientUid}`)).then((s) => {
    const cur = Number(s.val()) || 0;
    set(ref(db, `dms/${roomId}/meta/unread/${recipientUid}`), cur + 1);
  });
}

function updateDMLastMessage(text) {
  if (currentChatMode !== "dm" || !roomId) return;
  set(ref(db, `dms/${roomId}/meta/lastMessage`), {
    text: text.slice(0, 60),
    ts: Date.now(),
    senderName: myName
  });
}

function encodeEmoji(e) {
  return encodeURIComponent(e);
}

function notifyIfHidden(msg) {
  if (!document.hidden) return;
  if (msg.uid === userId) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = msg.type === "image" ? "📷 Sent an image"
    : msg.unsent ? "Message unsent"
    : (msg.text || "").slice(0, 120) || "New message";
  const title = currentChatMode === "dm" && currentDMOtherUser
    ? `${msg.sender} (@${currentDMOtherUser.name})`
    : `${msg.sender} in #${roomId}`;
  try {
    new Notification(title, { body, tag: "chatroom-msg" });
  } catch { /* ignore */ }
}

function getTickStatus(msg) {
  if (msg.uid !== userId) return null;
  if (msg.type !== "msg" && msg.type !== "image") return null;
  if (msg.unsent) return null;

  const members = Object.keys(currentMembers);
  const otherMembers = members.filter((id) => id !== userId);
  if (otherMembers.length === 0) return "sent";

  const readByAll = otherMembers.every((id) =>
    readReceipts[id] && readReceipts[id].lastReadTs >= msg.ts
  );
  const readBySome = otherMembers.some((id) =>
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
  document.querySelectorAll(".msg-row[data-msgkey].me").forEach((row) => {
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
    } catch { /* ignore */ }
  }
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
  if (unsendBtn) unsendBtn.style.display = isOwn && !msg.unsent ? "" : "none";
  menu.style.display = "block";
  const cx = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
  const cy = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
  menu.style.left = Math.min(cx, window.innerWidth - 180) + "px";
  menu.style.top = Math.min(cy, window.innerHeight - 200) + "px";
}

function attachContextMenu(bubbleEl, msgKey, msg) {
  const isOwn = msg.uid === userId;
  bubbleEl.addEventListener("contextmenu", (e) => showCtx(e, msgKey, msg, isOwn));
  bubbleEl.addEventListener("touchstart", longPressHandler((e) => showCtx(e, msgKey, msg, isOwn)));
}

async function unsendMessage(msgKey) {
  const msg = messageByKey.get(msgKey);
  if (!msg || msg.uid !== userId || !roomId || !activeChatBase) return;
  hideCtxMenu();
  await set(ref(db, `${activeChatBase}/messages/${msgKey}`), {
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
  if (!roomId || !activeChatBase) return;
  const path = `${activeChatBase}/messages/${msgKey}/reactions/${encodeEmoji(emoji)}`;
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
    imgEl.onload = () => loading.remove();
    imgEl.onerror = () => { loading.textContent = "⚠️"; };
    imgEl.src = msg.imageUrl;
    imgEl.onclick = () => openLightbox(msg.imageUrl);
    bubble.appendChild(imgEl);
    bubble.classList.add("msg-bubble-img");
  } else {
    bubble.textContent = msg.text || "";
  }

  if (!unsent) attachContextMenu(bubble, msgKey, msg);

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

function onVisibility() {
  if (!document.hidden && activeChatBase) updateReadReceiptAt(activeChatBase);
}

function onWinFocus() {
  if (activeChatBase) updateReadReceiptAt(activeChatBase);
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
  if (!text || !activeChatBase) return;
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
  push(ref(db, `${activeChatBase}/messages`), payload);
  updateDMLastMessage(text);
  if (currentChatMode === "dm" && currentDMOtherUser) {
    bumpDmUnreadFor(currentDMOtherUser.id);
  }
};

window.onTyping = function () {
  if (!typingRef) return;
  set(typingRef, { name: myName, ts: Date.now() });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(clearTypingState, 2500);
};

function clearTypingState() {
  clearTimeout(typingTimeout);
  if (typingRef) remove(typingRef);
}

window.leaveChat = function () {
  const base = activeChatBase;
  if (!base || !roomId || !userId) return;

  push(ref(db, `${base}/messages`), { type: "system", text: `${myName} left`, ts: Date.now() });
  clearTypingState();
  remove(presenceRef);
  remove(ref(db, `${base}/readReceipts/${userId}`));

  off(ref(db, `${base}/messages`));
  off(ref(db, `${base}/members`));
  off(ref(db, `${base}/typing`));
  off(ref(db, `${base}/readReceipts`));

  if (chatGlobalsBound) {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onWinFocus);
    document.removeEventListener("keydown", onGlobalKeydown);
    chatGlobalsBound = false;
  }

  document.getElementById("messages").innerHTML = "";
  hideCtxMenu();
  cancelReply();
  closeSearch();
  seenMessageKeys = null;
  skipNotifyForNextMessagesSnapshot = true;
  readReceipts = {};
  currentMembers = {};
  messageByKey.clear();
  currentDMOtherUser = null;
  currentChatMode = "room";
  activeChatBase = "";
  roomId = null;
  presenceRef = null;
  typingRef = null;

  showScreen("homeScreen");
  loadHomeScreen();
};

document.addEventListener("click", (e) => {
  const menu = document.getElementById("ctxMenu");
  if (!menu || menu.style.display !== "block") return;
  if (!menu.contains(e.target)) hideCtxMenu();
});

const ctxMenuEl = document.getElementById("ctxMenu");
if (ctxMenuEl) ctxMenuEl.addEventListener("click", (e) => e.stopPropagation());

document.getElementById("ctxUnsend")?.addEventListener("click", () => {
  if (ctxTarget) unsendMessage(ctxTarget.msgKey);
});

document.getElementById("ctxReply")?.addEventListener("click", () => {
  if (ctxTarget) startReply(ctxTarget.msgKey, ctxTarget.msg);
});

document.getElementById("ctxReact")?.addEventListener("click", () => {
  document.getElementById("ctxEmojiRow")?.classList.toggle("is-open");
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
  if (!file || !roomId || !activeChatBase) return;
  if (file.size > 3 * 1024 * 1024) {
    alert("Image must be under 3MB");
    e.target.value = "";
    return;
  }
  showUploadPreview(true);
  try {
    const base64 = await compressAndEncode(file, 800, 0.75);
    push(ref(db, `${activeChatBase}/messages`), {
      type: "image",
      text: "",
      imageUrl: base64,
      sender: myName,
      uid: userId,
      color: myColor,
      ts: Date.now()
    });
    updateDMLastMessage("📷 Photo");
    if (currentChatMode === "dm" && currentDMOtherUser) {
      bumpDmUnreadFor(currentDMOtherUser.id);
    }
  } catch {
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
  if (show) document.getElementById("searchInput")?.focus();
  else closeSearch();
});

window.searchMessages = searchMessages;
window.closeSearch = closeSearch;

async function bootstrap() {
  buildColorRow();
  const identity = loadIdentity();
  if (identity?.userId && identity?.name) {
    try {
      const snap = await get(ref(db, `users/${identity.userId}`));
      if (snap.exists()) {
        const u = snap.val();
        userId = identity.userId;
        myName = u.name || identity.name;
        myColor = u.color || identity.color || COLORS[0];
        syncColorPickerUI(myColor);
        await set(ref(db, `users/${userId}/lastSeen`), Date.now());
        saveIdentity({ userId, name: myName, color: myColor });
        showScreen("homeScreen");
        loadHomeScreen();
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }
  showScreen("authScreen");
}

bootstrap();
