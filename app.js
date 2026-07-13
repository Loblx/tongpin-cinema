const prefsKey = "tongpin-cinema-prefs-v2";

const defaultRoom = {
  roomCode: "TP-0726",
  playing: false,
  current: 768,
  duration: 6480,
  updatedAt: Date.now(),
  favorite: false,
  title: "今晚的片单",
  queue: [
    { title: "片头前 3 分钟集合", meta: "20:30" },
    { title: "正片同步播放", meta: "20:35" },
    { title: "片后 10 分钟语音复盘", meta: "22:25" }
  ],
  members: [],
  chat: [
    { who: "房主", text: "进入同一个链接后，播放状态会自动互通。", time: "20:28" }
  ],
  timeline: [
    { time: "20:20", text: "创建房间并确认片源" },
    { time: "20:35", text: "房主点击同步播放" }
  ]
};

let prefs = loadPrefs();
let state = { ...structuredClone(defaultRoom), roomCode: prefs.roomCode };
let ticker = null;
let polling = null;
let lastVersion = 0;
let dragging = false;
let peerConnection = null;
let peerChannel = null;

const $ = (id) => document.getElementById(id);

function loadPrefs() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  try {
    const stored = JSON.parse(localStorage.getItem(prefsKey)) || {};
    return {
      roomCode: room || stored.roomCode || defaultRoom.roomCode,
      viewerName: stored.viewerName || "我",
      clientId: stored.clientId || crypto.randomUUID()
    };
  } catch {
    return {
      roomCode: room || defaultRoom.roomCode,
      viewerName: "我",
      clientId: crypto.randomUUID()
    };
  }
}

function savePrefs() {
  localStorage.setItem(prefsKey, JSON.stringify(prefs));
}

function formatTime(value) {
  const safe = Math.max(0, Math.floor(value));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, mins, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function currentPlaybackTime(room = state) {
  if (!room.playing) return room.current;
  const elapsed = (Date.now() - room.updatedAt) / 1000;
  return Math.min(room.duration, room.current + elapsed);
}

function shareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.roomCode);
  return url.toString();
}

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function mergeRoom(next) {
  if (!next || typeof next !== "object") return;
  state = { ...state, ...next };
  lastVersion = next.version || lastVersion;
  prefs.roomCode = state.roomCode;
  savePrefs();
  render();
}

async function apiGetRoom() {
  const url = `/api/room?room=${encodeURIComponent(prefs.roomCode)}&clientId=${encodeURIComponent(prefs.clientId)}&name=${encodeURIComponent(prefs.viewerName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`room ${response.status}`);
  return response.json();
}

async function apiEvent(type, payload = {}) {
  const response = await fetch("/api/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      room: prefs.roomCode,
      clientId: prefs.clientId,
      name: prefs.viewerName,
      type,
      payload
    })
  });
  if (!response.ok) throw new Error(`event ${response.status}`);
  return response.json();
}

async function pollRoom() {
  try {
    const room = await apiGetRoom();
    $("saveState").textContent = "在线同步";
    mergeRoom(room);
  } catch {
    $("saveState").textContent = "离线重试";
  }
}

async function sendEvent(type, payload = {}) {
  applyRoomEvent(type, payload, prefs.viewerName);
  sendPeerEvent(type, payload);
  try {
    const room = await apiEvent(type, payload);
    $("saveState").textContent = isPeerConnected() ? "点对点同步" : "已同步";
    mergeRoom(room);
  } catch {
    $("saveState").textContent = isPeerConnected() ? "点对点同步" : "离线/未同步";
  }
}

function applyRoomEvent(type, payload, actor = "成员") {
  if (type === "playback") {
    state.playing = payload.playing;
    state.current = payload.current;
    state.updatedAt = Date.now();
    state.timeline.unshift({ time: nowHHMM(), text: actor + (payload.playing ? " 开始播放" : " 暂停播放") });
  }
  if (type === "seek") {
    state.current = payload.current;
    state.updatedAt = Date.now();
    state.timeline.unshift({ time: nowHHMM(), text: actor + " 拖动到 " + formatTime(payload.current) });
  }
  if (type === "sync") {
    state.current = payload.current;
    state.updatedAt = Date.now();
    state.timeline.unshift({ time: nowHHMM(), text: actor + " 发起同步" });
  }
  if (type === "queue:add") {
    state.queue.push({ title: payload.title, meta: "待播放" });
    state.title = payload.title;
    state.timeline.unshift({ time: nowHHMM(), text: actor + " 加入片单：" + payload.title });
  }
  if (type === "queue:clear") {
    state.queue = defaultRoom.queue;
    state.timeline.unshift({ time: nowHHMM(), text: actor + " 恢复默认片单" });
  }
  if (type === "chat") {
    state.chat.push({ who: actor, text: payload.text, time: nowHHMM() });
    state.chat = state.chat.slice(-40);
  }
  if (type === "favorite") {
    state.favorite = Boolean(payload.favorite);
  }
  if (type === "identity") {
    upsertMember({ clientId: payload.clientId || "peer", name: actor, drift: "+0.00s" });
  }
  state.timeline = state.timeline.slice(0, 10);
  render();
}

function upsertMember(member) {
  const id = member.clientId || member.name;
  const existing = state.members.find((item) => (item.clientId || item.name) === id);
  if (existing) {
    Object.assign(existing, member);
  } else {
    state.members.push(member);
  }
}

function render() {
  const current = currentPlaybackTime();
  $("roomCode").textContent = state.roomCode;
  $("viewerName").value = prefs.viewerName;
  $("shareUrl").value = shareUrl();
  $("movieTitle").textContent = state.title;
  $("currentTime").textContent = formatTime(current);
  $("hostTime").textContent = formatTime(current);
  $("duration").textContent = formatTime(state.duration);
  if (!dragging) {
    $("progressRange").value = Math.floor(current);
  }
  $("progressRange").max = state.duration;
  $("playBtn").textContent = state.playing ? "Ⅱ 暂停" : "▶ 播放";
  $("favoriteBtn").textContent = state.favorite ? "★" : "☆";
  $("memberCount").textContent = String(state.members.length);

  const self = state.members.find((member) => member.clientId === prefs.clientId);
  const drift = self?.drift || "+0.00s";
  $("latency").textContent = drift;
  const driftValue = Math.max(...state.members.map((member) => Math.abs(parseFloat(member.drift) || 0)), 0);
  $("syncBadge").className = driftValue > 1 ? "status warn" : "status good";
  $("syncBadge").textContent = driftValue > 1 ? "需同步" : "同频";

  renderMembers();
  renderQueue();
  renderChat();
  renderTimeline();
}

function renderMembers() {
  $("memberList").innerHTML = state.members.map((member) => `
    <li>
      <span class="member-name">
        <span class="avatar">${member.name.slice(0, 1)}</span>
        <span>${member.name}${member.host ? " · 房主" : ""}${member.clientId === prefs.clientId ? " · 我" : ""}</span>
      </span>
      <span class="drift">${member.drift}</span>
    </li>
  `).join("");
}

function isPeerConnected() {
  return peerChannel && peerChannel.readyState === "open";
}

function setPeerStatus(text) {
  $("p2pStatus").textContent = text;
  if (isPeerConnected()) {
    $("saveState").textContent = "点对点同步";
  }
}

function encodeSignal(value) {
  return btoa(JSON.stringify(value));
}

function decodeSignal(value) {
  return JSON.parse(atob(value.trim()));
}

function waitForIceComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2500);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function createPeerConnection() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  pc.addEventListener("connectionstatechange", () => {
    setPeerStatus(pc.connectionState === "connected" ? "已直连" : pc.connectionState);
  });
  return pc;
}

function bindChannel(channel) {
  peerChannel = channel;
  channel.addEventListener("open", () => {
    setPeerStatus("已直连");
    upsertMember({ clientId: prefs.clientId, name: prefs.viewerName, drift: "+0.00s" });
    sendPeerEvent("identity", { clientId: prefs.clientId });
    sendPeerEvent("state:snapshot", { state });
    render();
  });
  channel.addEventListener("close", () => setPeerStatus("已断开"));
  channel.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.from === prefs.clientId) return;
    if (message.type === "state:snapshot" && message.payload?.state) {
      mergePeerState(message.payload.state, message.name);
      return;
    }
    applyRoomEvent(message.type, message.payload || {}, message.name || "对象");
  });
}

function mergePeerState(peerState, actor) {
  state = {
    ...state,
    ...peerState,
    roomCode: prefs.roomCode,
    members: [...state.members, ...peerState.members]
  };
  const seen = new Map();
  state.members.forEach((member) => seen.set(member.clientId || member.name, member));
  state.members = [...seen.values()];
  upsertMember({ clientId: "peer", name: actor || "对象", drift: "+0.00s" });
  render();
}

function sendPeerEvent(type, payload = {}) {
  if (!isPeerConnected()) return;
  peerChannel.send(JSON.stringify({
    type,
    payload,
    from: prefs.clientId,
    name: prefs.viewerName,
    sentAt: Date.now()
  }));
}

function renderQueue() {
  $("queueList").innerHTML = state.queue.map((item, index) => `
    <li>
      <span>${item.title}</span>
      <span class="queue-meta">${item.meta || `#${index + 1}`}</span>
    </li>
  `).join("");
}

function renderChat() {
  $("chatLog").innerHTML = state.chat.map((message) => `
    <div class="chat-message">
      <div class="chat-meta">${message.time}</div>
      <strong>${message.who}</strong><span>${message.text}</span>
    </div>
  `).join("");
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

function renderTimeline() {
  $("timelineList").innerHTML = state.timeline.map((item) => `
    <li>
      <div>
        <time>${item.time}</time>
        <div>${item.text}</div>
      </div>
    </li>
  `).join("");
}

$("playBtn").addEventListener("click", () => {
  sendEvent("playback", {
    playing: !state.playing,
    current: currentPlaybackTime()
  });
});

$("backBtn").addEventListener("click", () => {
  sendEvent("seek", { current: Math.max(0, currentPlaybackTime() - 15) });
});

$("forwardBtn").addEventListener("click", () => {
  sendEvent("seek", { current: Math.min(state.duration, currentPlaybackTime() + 15) });
});

$("syncBtn").addEventListener("click", () => {
  sendEvent("sync", { current: currentPlaybackTime() });
});

$("favoriteBtn").addEventListener("click", () => {
  sendEvent("favorite", { favorite: !state.favorite });
});

$("progressRange").addEventListener("input", (event) => {
  dragging = true;
  const current = Number(event.target.value);
  $("currentTime").textContent = formatTime(current);
  $("hostTime").textContent = formatTime(current);
});

$("progressRange").addEventListener("change", (event) => {
  dragging = false;
  sendEvent("seek", { current: Number(event.target.value) });
});

$("queueForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const title = $("queueTitle").value.trim();
  if (!title) return;
  $("queueTitle").value = "";
  sendEvent("queue:add", { title });
});

$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) return;
  $("chatInput").value = "";
  sendEvent("chat", { text });
});

$("identityForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("viewerName").value.trim();
  if (!name) return;
  prefs.viewerName = name.slice(0, 12);
  savePrefs();
  sendEvent("identity", {});
});

$("clearQueueBtn").addEventListener("click", () => {
  sendEvent("queue:clear");
});

$("copyInviteBtn").addEventListener("click", async () => {
  const invite = `加入同频影院：房间 ${$("roomCode").textContent}，当前时间 ${formatTime(currentPlaybackTime())}\n${shareUrl()}`;
  try {
    await navigator.clipboard.writeText(invite);
    $("copyInviteBtn").textContent = "已复制";
  } catch {
    $("copyInviteBtn").textContent = "复制失败";
  }
  setTimeout(() => {
    $("copyInviteBtn").textContent = "复制邀请";
  }, 1400);
});

$("copyUrlBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrl());
    $("copyUrlBtn").textContent = "已复制";
  } catch {
    $("copyUrlBtn").textContent = "复制失败";
  }
  setTimeout(() => {
    $("copyUrlBtn").textContent = "复制链接";
  }, 1400);
});

$("createOfferBtn").addEventListener("click", async () => {
  try {
    peerConnection = createPeerConnection();
    bindChannel(peerConnection.createDataChannel("tongpin-sync"));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceComplete(peerConnection);
    $("signalBox").value = encodeSignal(peerConnection.localDescription);
    setPeerStatus("等待回应码");
  } catch (error) {
    $("signalBox").value = "创建失败：" + error.message;
    setPeerStatus("创建失败");
  }
});

$("createAnswerBtn").addEventListener("click", async () => {
  try {
    const offer = decodeSignal($("signalBox").value);
    peerConnection = createPeerConnection();
    peerConnection.addEventListener("datachannel", (event) => bindChannel(event.channel));
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceComplete(peerConnection);
    $("signalBox").value = encodeSignal(peerConnection.localDescription);
    setPeerStatus("回应码已生成");
  } catch (error) {
    $("signalBox").value = "回应失败：" + error.message;
    setPeerStatus("回应失败");
  }
});

$("applySignalBtn").addEventListener("click", async () => {
  try {
    if (!peerConnection) throw new Error("请先点“我是房主”生成配对码");
    const answer = decodeSignal($("signalBox").value);
    await peerConnection.setRemoteDescription(answer);
    setPeerStatus("正在连接");
  } catch (error) {
    $("signalBox").value = "应用失败：" + error.message;
    setPeerStatus("应用失败");
  }
});

$("copySignalBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("signalBox").value);
    $("copySignalBtn").textContent = "已复制";
  } catch {
    $("copySignalBtn").textContent = "复制失败";
  }
  setTimeout(() => {
    $("copySignalBtn").textContent = "复制配对码";
  }, 1400);
});

function startTicker() {
  ticker = setInterval(render, 1000);
  polling = setInterval(pollRoom, 1200);
}

render();
pollRoom();
startTicker();
