const fs = require("fs");
const path = require("path");

const root = __dirname;
const out = path.join(root, "dist");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "assets"), { recursive: true });
fs.mkdirSync(path.join(out, "server"), { recursive: true });

for (const file of ["index.html", "styles.css", "app.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

fs.copyFileSync(
  path.join(root, "assets", "theater-poster.svg"),
  path.join(out, "assets", "theater-poster.svg")
);

fs.mkdirSync(path.join(out, ".openai"), { recursive: true });
fs.copyFileSync(
  path.join(root, ".openai", "hosting.json"),
  path.join(out, ".openai", "hosting.json")
);

const files = {
  "/": { type: "text/html; charset=utf-8", body: fs.readFileSync(path.join(root, "index.html"), "utf8") },
  "/index.html": { type: "text/html; charset=utf-8", body: fs.readFileSync(path.join(root, "index.html"), "utf8") },
  "/styles.css": { type: "text/css; charset=utf-8", body: fs.readFileSync(path.join(root, "styles.css"), "utf8") },
  "/app.js": { type: "application/javascript; charset=utf-8", body: fs.readFileSync(path.join(root, "app.js"), "utf8") },
  "/assets/theater-poster.svg": { type: "image/svg+xml; charset=utf-8", body: fs.readFileSync(path.join(root, "assets", "theater-poster.svg"), "utf8") }
};

const worker = `const files = ${JSON.stringify(files)};
const rooms = globalThis.__tongpinRooms || new Map();
globalThis.__tongpinRooms = rooms;

const defaultRoom = {
  playing: false,
  current: 768,
  duration: 6480,
  updatedAt: Date.now(),
  version: 1,
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function nowHHMM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function playbackCurrent(room) {
  if (!room.playing) return room.current;
  const elapsed = (Date.now() - room.updatedAt) / 1000;
  return Math.min(room.duration, room.current + elapsed);
}

function stateRequest(roomCode) {
  return new Request("https://tongpin.local/state/" + encodeURIComponent(roomCode || "TP-0726"));
}

async function readCachedRoom(roomCode) {
  try {
    if (typeof caches === "undefined") return null;
    const response = await caches.default.match(stateRequest(roomCode));
    if (!response) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  }
}

async function writeCachedRoom(room) {
  try {
    if (typeof caches === "undefined") return;
    await caches.default.put(
      stateRequest(room.roomCode),
      new Response(JSON.stringify(room), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=86400"
        }
      })
    );
  } catch {
    return;
  }
}

async function getRoom(roomCode) {
  const code = roomCode || "TP-0726";
  const cached = await readCachedRoom(code);
  if (cached) {
    rooms.set(code, cached);
    return cached;
  }
  if (!rooms.has(code)) {
    rooms.set(code, { ...clone(defaultRoom), roomCode: code, createdAt: Date.now() });
  }
  return rooms.get(code);
}

function touchMember(room, clientId, name) {
  const id = clientId || "guest";
  const safeName = (name || "我").slice(0, 12);
  const current = playbackCurrent(room);
  let member = room.members.find((item) => item.clientId === id);
  if (!member) {
    member = {
      clientId: id,
      name: safeName,
      host: room.members.length === 0,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      drift: "+0.00s"
    };
    room.members.push(member);
    room.timeline.unshift({ time: nowHHMM(), text: safeName + " 进入房间" });
  }
  member.name = safeName;
  member.lastSeen = Date.now();
  member.drift = (Math.random() > 0.5 ? "+" : "-") + (Math.random() * 0.35).toFixed(2) + "s";
  room.members = room.members.filter((item) => Date.now() - item.lastSeen < 1000 * 60 * 10);
  room.current = current;
  room.updatedAt = Date.now();
  return member;
}

function bump(room, text) {
  room.version += 1;
  room.timeline.unshift({ time: nowHHMM(), text });
  room.timeline = room.timeline.slice(0, 10);
  room.updatedAt = Date.now();
}

function publicRoom(room) {
  const copy = clone(room);
  copy.current = playbackCurrent(room);
  copy.updatedAt = Date.now();
  return copy;
}

async function handleApi(request, url) {
  if (url.pathname === "/api/room" && request.method === "GET") {
    const room = await getRoom(url.searchParams.get("room"));
    touchMember(room, url.searchParams.get("clientId"), url.searchParams.get("name"));
    await writeCachedRoom(room);
    return json(publicRoom(room));
  }

  if (url.pathname === "/api/event" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "invalid json" }, 400);
    const room = await getRoom(body.room);
    const member = touchMember(room, body.clientId, body.name);
    const payload = body.payload || {};
    const actor = member.name || "成员";

    if (body.type === "playback") {
      room.current = Number(payload.current) || playbackCurrent(room);
      room.playing = Boolean(payload.playing);
      bump(room, actor + (room.playing ? " 开始播放" : " 暂停播放"));
    } else if (body.type === "seek") {
      room.current = Math.max(0, Math.min(room.duration, Number(payload.current) || 0));
      bump(room, actor + " 拖动到 " + Math.floor(room.current) + " 秒");
    } else if (body.type === "sync") {
      room.current = Number(payload.current) || playbackCurrent(room);
      bump(room, actor + " 发起全员同步");
    } else if (body.type === "favorite") {
      room.favorite = Boolean(payload.favorite);
      room.version += 1;
    } else if (body.type === "queue:add" && payload.title) {
      room.queue.push({ title: String(payload.title).slice(0, 80), meta: "待播放" });
      room.title = String(payload.title).slice(0, 80);
      bump(room, actor + " 加入片单：" + room.title);
    } else if (body.type === "queue:clear") {
      room.queue = clone(defaultRoom.queue);
      bump(room, actor + " 恢复默认片单");
    } else if (body.type === "chat" && payload.text) {
      room.chat.push({ who: actor, text: String(payload.text).slice(0, 200), time: nowHHMM() });
      room.chat = room.chat.slice(-60);
      room.version += 1;
    } else if (body.type === "identity") {
      bump(room, actor + " 更新了昵称");
    } else {
      room.version += 1;
    }

    await writeCachedRoom(room);
    return json(publicRoom(room));
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url);
    }
    const file = files[url.pathname] || files["/"];
    return new Response(file.body, {
      headers: {
        "content-type": file.type,
        "cache-control": url.pathname === "/" || url.pathname === "/index.html" ? "no-store" : "public, max-age=3600"
      }
    });
  }
};
`;

fs.writeFileSync(path.join(out, "server", "index.js"), worker, "utf8");
