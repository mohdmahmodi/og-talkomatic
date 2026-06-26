/*
 **  ==========================================================================
 **  Talkomatic Server
 **  ==========================================================================
 **
 **  A faithful, self-contained reimplementation of the server that the
 **  original Talkomatic browser client talks to. It speaks the exact
 **  pipe-delimited wire protocol expected by BOTH the "classic" (v3) client
 **  (lobby.js / talko.js) and the "new" (v4) client (lobby_en.js / talko_en.js).
 **
 **      Original client: David R. Woolley & Steven J. Zoppi (2014-2021)
 **      Server reimplementation for the community revival.
 **
 **  Everything is held in memory: nothing is persisted and no chat content is
 **  ever stored beyond the moment it is relayed, matching the original design.
 **
 **  ------------------------------------------------------------------------
 **  WIRE PROTOCOL
 **  ------------------------------------------------------------------------
 **  Client -> Server (Socket.IO "message" events):
 **      E|name|location|auth|link|room|userId|privacy|key|specs   Enter a room
 **      X                                                          Leave the room
 **      U|deleteChars|changeIndex|newText                         Incremental text edit
 **      A|text                                                     Full text (reply to an Enter)
 **      P                                                          Heartbeat (poke)
 **      V|direction|slot                                           Up/down vote a talker (+/-)
 **      K|direction|name|location                                  Host grants(+)/denies(-) access
 **
 **  Server -> Client:
 **      W|slot                  Slot assignment (entry succeeded)
 **      W|full | W|key | W|dup   Entry rejected (room full / wrong key / duplicate identity)
 **      R|hostSlot|privacy       Room information sent right after entry
 **      E|slot|name|loc|auth|link  Another talker entered
 **      X|slot                   A talker left
 **      U|slot|del|index|text    Another talker edited their text
 **      A|slot|name|loc|auth|link|text   Full snapshot of another talker
 **      P                        Heartbeat reply
 **      Z                        Server asks the client to return to the lobby (kicked/expelled)
 **      K|hostSlot|name|loc\n...  Pending access requests for a semi-private host
 **
 **  HTTP:
 **      GET /                     Entry page (index.html)
 **      GET /index                Entry page (used by invite links: /index?r=<zvvy>)
 **      GET /roominfo.json        Lobby room listing (JSON), honouring privacy + keys
 **      GET /<static asset>       HTML / CSS / JS / images / sounds
 */

"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const socketIO = require("socket.io");

// ---------------------------------------------------------------------------
// Configuration & limits
// ---------------------------------------------------------------------------

// Port resolution order: $PORT, then a "--port N" argument, then 3000.
const argPortIdx = process.argv.indexOf("--port");
const argPort =
  argPortIdx !== -1 ? parseInt(process.argv[argPortIdx + 1], 10) : NaN;
const PORT = process.env.PORT || (Number.isFinite(argPort) ? argPort : 4001);
const PUBLIC_DIR = path.join(__dirname, ".."); // project root holds all client assets

const MAX_SLOTS = 5; // talkers per room (must match the client)
const MAX_ROOMS = 500; // safety cap on simultaneously open rooms
const MAX_NAME_LEN = 200; // generous caps (cleaned text can be longer than raw input)
const MAX_LOC_LEN = 200;
const MAX_ROOM_LEN = 250;
const MAX_KEY_LEN = 200;
const MAX_TEXT_LEN = 8000; // a 5-line textarea never needs more; guards against abuse
const MAX_MSG_PER_SEC = 80; // per-connection message rate ceiling

// Privacy levels (mirrors the client constants).
const PRIVACY_PUBLIC = 0;
const PRIVACY_SEMIPRIVATE = 1;
const PRIVACY_PRIVATE = 2;

// Rooms that always exist in the lobby, even when empty.
const PERMANENT_ROOMS = ["Hangout 247", "CERL165A-B", "Cyber1"];

const INFO_KEY = "info>"; // pseudo-occupant in room data that carries room settings

// ---------------------------------------------------------------------------
// Encoding / sanitisation helpers
// ---------------------------------------------------------------------------

/*
 **  fromZvvyCode - decode a ZvvyCode-encoded string (see global_util_en.js).
 **  Keys and lobby parameters arrive ZvvyCode-encoded in query strings.
 **  Returns the decoded plain text (or the input unchanged if it is not encoded).
 */
function fromZvvyCode(str) {
  if (typeof str !== "string" || str.length < 8) {
    return str || "";
  }

  const escChr = str.charCodeAt(0);
  const escChrStr = str.charAt(0);

  // A leading letter or digit means the string was never ZvvyCode-encoded.
  if (
    (escChr >= 0x30 && escChr <= 0x39) ||
    (escChr >= 0x41 && escChr <= 0x5a) ||
    (escChr >= 0x61 && escChr <= 0x7a)
  ) {
    return str;
  }

  // Verify the "<esc><esc>zvvy<esc><esc>" signature.
  if (
    escChrStr !== str.charAt(1) ||
    escChrStr !== str.charAt(6) ||
    escChrStr !== str.charAt(7) ||
    str.substring(2, 6) !== "zvvy"
  ) {
    return str;
  }

  let result = "";
  let i = 8;
  const len = str.length;

  while (i < len) {
    const escPos = str.indexOf(escChrStr, i);
    if (escPos < 0) {
      result += str.substring(i);
      return result;
    }
    result += str.substring(i, escPos);
    i = escPos + 1;
    const escPos2 = str.indexOf(escChrStr, i);
    if (escPos2 < 0) {
      return result; // malformed; return what we have
    }
    const hex = str.substring(i, escPos2);
    const code = parseInt(hex, 16);
    if (Number.isNaN(code)) {
      return result;
    }
    result += String.fromCharCode(code);
    i = escPos2 + 1;
  }
  return result;
}

/*
 **  sanitizeDisplay - neutralise the four characters that could break out of
 **  an HTML context when a name/location is rendered with jQuery .html().
 **
 **  The client already runs cleanText() on these fields, whose output never
 **  contains a raw < > " or '. Escaping only those characters therefore leaves
 **  honest input untouched (no double-encoding of &amp; etc.) while defusing a
 **  malicious client that sends raw markup. The vertical bar is dropped because
 **  it is the protocol delimiter and must never appear inside a field.
 */
function sanitizeDisplay(str) {
  if (typeof str !== "string") {
    return "";
  }
  return str
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&#34;")
    .replace(/'/g, "&#39;")
    .replace(/\|/g, "&#124;");
}

// Trim a string to a maximum length.
function clampLen(str, max) {
  if (typeof str !== "string") {
    return "";
  }
  return str.length > max ? str.substring(0, max) : str;
}

/*
 **  sanitizeLink - a profile URL is rendered inside an href, so only allow
 **  plain http/https links. Anything else (e.g. javascript:) is discarded.
 */
function sanitizeLink(str) {
  if (typeof str !== "string" || str === "") {
    return "";
  }
  if (!/^https?:\/\//i.test(str)) {
    return "";
  }
  return sanitizeDisplay(clampLen(str, 400));
}

// A non-negative integer parsed from a protocol field, or a fallback.
function toIntField(str, fallback) {
  const n = parseInt(str, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// A short, URL/JSON/protocol-safe random token used as a semi-private grant key.
let keyCounter = 0;
function mintGrantKey() {
  keyCounter += 1;
  return (
    "spk" +
    Date.now().toString(36) +
    keyCounter.toString(36) +
    Math.floor(Math.random() * 0x10000).toString(36)
  );
}

// Compose the "name|loc" identity used to track semi-private access grants.
function identityOf(nameClean, locClean) {
  return nameClean + "|" + locClean;
}

// ---------------------------------------------------------------------------
// Room model
// ---------------------------------------------------------------------------

class Room {
  constructor(name, privacy, specs, key) {
    this.name = name;
    this.privacy = privacy; // 0 public, 1 semi-private, 2 private
    this.specs = specs === "v" ? "v" : "h";
    this.key = key || ""; // static key (private rooms only)
    this.permanent = false;

    this.host = null; // slot number of the host
    this.slots = new Array(MAX_SLOTS).fill(null);

    // Semi-private access control:
    //   grants  - identity ("name|loc") -> minted key the guest must present
    //   pending - identity -> { name, loc } awaiting the host's decision
    this.grants = new Map();
    this.pending = new Map();

    // Down-votes: slot -> Set of voter userIds (distinct voters only).
    this.downVotes = new Map();
  }

  firstFreeSlot() {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (!this.slots[i]) {
        return i;
      }
    }
    return -1;
  }

  isFull() {
    return this.firstFreeSlot() === -1;
  }

  isEmpty() {
    return this.slots.every((s) => !s);
  }

  occupants() {
    return this.slots.filter((s) => s !== null);
  }

  occupantCount() {
    return this.occupants().length;
  }

  userAt(slot) {
    return slot >= 0 && slot < MAX_SLOTS ? this.slots[slot] : null;
  }

  slotOfUserId(userId) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (this.slots[i] && this.slots[i].userId === userId) {
        return i;
      }
    }
    return -1;
  }

  addUser(user, slot) {
    this.slots[slot] = user;
    if (this.host === null) {
      this.host = slot;
    }
  }

  // Remove the occupant of a slot and tidy up host / votes.
  removeSlot(slot) {
    if (slot < 0 || slot >= MAX_SLOTS || !this.slots[slot]) {
      return;
    }
    const leavingId = this.slots[slot].userId;
    this.slots[slot] = null;
    // Forget votes cast against this slot...
    this.downVotes.delete(slot);
    // ...and any votes this user had cast against others (sets hold userIds).
    for (const voters of this.downVotes.values()) {
      voters.delete(leavingId);
    }
    if (this.host === slot) {
      // Hand the host role to the lowest remaining occupied slot.
      this.host = null;
      for (let i = 0; i < MAX_SLOTS; i++) {
        if (this.slots[i]) {
          this.host = i;
          break;
        }
      }
    }
  }

  hostSocketId() {
    const hostUser = this.userAt(this.host);
    return hostUser ? hostUser.socketId : null;
  }

  // True if the supplied key unlocks this room for entry.
  unlocks(providedKey, identity) {
    if (this.privacy === PRIVACY_PUBLIC) {
      return true;
    }
    if (this.privacy === PRIVACY_PRIVATE) {
      return this.key !== "" && this.key === providedKey;
    }
    // Semi-private: the key must match a grant minted for this identity.
    if (this.privacy === PRIVACY_SEMIPRIVATE) {
      const granted = this.grants.get(identity);
      return (
        granted !== undefined && granted === providedKey && providedKey !== ""
      );
    }
    return false;
  }

  /*
   **  Build the lobby JSON for this room from the requester's point of view.
   **  Occupant names/locations are only revealed when the requester is entitled
   **  to see them (public room, correct private key, or a semi-private grant).
   */
  toLobbyData(viewerKey, viewerIdentity) {
    const data = {};
    const info = {
      privacy: String(this.privacy),
      specs: this.specs,
      host: this.host,
    };

    // Semi-private rooms expose the viewer's personal grant key (if any) so the
    // client can colour the Enter button green and proceed to enter.
    if (this.privacy === PRIVACY_SEMIPRIVATE) {
      info.currentKey = this.grants.get(viewerIdentity) || "";
    }
    data[INFO_KEY] = info;

    let occupantsVisible;
    if (this.privacy === PRIVACY_PUBLIC) {
      occupantsVisible = true;
    } else if (this.privacy === PRIVACY_PRIVATE) {
      occupantsVisible = this.key !== "" && this.key === viewerKey;
    } else {
      // Semi-private occupant lists are public (the lobby shows who is inside),
      // which is what lets a would-be guest decide to knock.
      occupantsVisible = true;
    }

    if (occupantsVisible) {
      for (const user of this.occupants()) {
        data[user.nameClean] = user.locClean;
      }
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const rooms = new Map(); // room name -> Room
const users = new Map(); // socket.id -> user record

function createPermanentRooms() {
  for (const name of PERMANENT_ROOMS) {
    const room = new Room(name, PRIVACY_PUBLIC, "h", "");
    room.permanent = true;
    rooms.set(name, room);
  }
}
createPermanentRooms();

// Remove a room if it is empty and not permanent.
function reapRoomIfEmpty(room) {
  if (room && !room.permanent && room.isEmpty()) {
    rooms.delete(room.name);
  }
}

// ---------------------------------------------------------------------------
// HTTP application
// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");

// The invite links generated by the client point at "/index?r=<zvvyroom>".
// Serve the entry page for that path (express.static only maps it to "/").
app.get("/index", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/*
 **  GET /roominfo.json - the lobby polls this for the live room list.
 **
 **  Recognised query parameters (all ZvvyCode-encoded by the client):
 **      key      private-room key, used to reveal a private room's occupants
 **      SPRkey   semi-private grant key (informational)
 **      unc/ulc  the viewer's cleaned name / location (identity for grants)
 **      reqRoom  a semi-private room the viewer is requesting access to (a knock)
 */
app.get(["/roominfo.json", "/roominfo.json/"], (req, res) => {
  const viewerKey = fromZvvyCode(req.query.key || "");
  const viewerName = sanitizeDisplay(fromZvvyCode(req.query.unc || ""));
  const viewerLoc = sanitizeDisplay(fromZvvyCode(req.query.ulc || ""));
  const viewerIdentity = identityOf(viewerName, viewerLoc);
  const reqRoom = fromZvvyCode(req.query.reqRoom || "");

  // A "knock": register the viewer's request to join a semi-private room.
  if (reqRoom && viewerName) {
    registerAccessRequest(reqRoom, viewerName, viewerLoc);
  }

  const out = {};
  for (const room of rooms.values()) {
    out[room.name] = room.toLobbyData(viewerKey, viewerIdentity);
  }

  res.set("Cache-Control", "no-store");
  res.json(out);
});

// Never expose the server's own source directory over HTTP.
app.use("/server", (req, res) => res.status(404).end());

// All remaining paths are static client assets from the project root.
//
// Caching matters a lot here: each page pulls in jQuery and jQuery UI (about
// 600 KB together) plus the fonts. Those third-party files never change, so we
// let the browser keep them for a month instead of re-fetching them on every
// enter/leave. Our own HTML, JS, and CSS are told to revalidate so edits and
// deploys show up right away.
app.use(
  express.static(PUBLIC_DIR, {
    index: "index.html",
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      const p = filePath.replace(/\\/g, "/");
      if (/\.html$/i.test(p)) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (
        /\/jqueryui\//i.test(p) ||
        /jquery-3\.3\.1\.min\.js$/i.test(p) ||
        /\/stylesheets\/(w3|font-awesome)\.css$/i.test(p) ||
        /\/stylesheets\/fonts\//i.test(p)
      ) {
        // Third-party libraries and fonts: safe to cache for a long time.
        res.setHeader("Cache-Control", "public, max-age=2592000"); // 30 days
      } else if (/\/(images|sounds)\//i.test(p)) {
        res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day
      } else {
        // Our own JS and CSS: revalidate every load (fast 304, never stale).
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

const server = http.createServer(app);

// Turn off Nagle's algorithm so a single keystroke goes out immediately instead
// of waiting to be batched with later bytes.
server.on("connection", (socket) => socket.setNoDelay(true));

const io = socketIO(server, {
  serveClient: true, // serve a matching client at /socket.io/socket.io.js
  maxHttpBufferSize: 1e6,
  perMessageDeflate: false, // chat messages are tiny; skip compression overhead
  // Notice a dropped connection in about 10 to 20 seconds instead of the ~45s
  // default. This is what clears out someone who closed the tab or swiped the
  // app away on a phone without a clean exit.
  pingInterval: 10000,
  pingTimeout: 10000,
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  socket._msgWindowStart = Date.now();
  socket._msgCount = 0;

  socket.on("message", (raw) => {
    if (typeof raw !== "string" || raw.length > MAX_TEXT_LEN + 256) {
      return;
    }
    if (isRateLimited(socket)) {
      return;
    }
    try {
      dispatch(socket, raw);
    } catch (err) {
      console.error("[message error]", err);
    }
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, false);
  });

  socket.on("error", (err) => {
    console.error(`[socket error] ${socket.id}:`, err && err.message);
  });
});

// Simple fixed-window rate limiter. Returns true when the message must be dropped.
function isRateLimited(socket) {
  const now = Date.now();
  if (now - socket._msgWindowStart >= 1000) {
    socket._msgWindowStart = now;
    socket._msgCount = 0;
  }
  socket._msgCount += 1;
  return socket._msgCount > MAX_MSG_PER_SEC;
}

function dispatch(socket, raw) {
  const sep = raw.indexOf("|");
  const command = sep === -1 ? raw : raw.substring(0, sep);

  switch (command) {
    case "E":
      handleEnter(socket, raw);
      break;
    case "X":
      leaveCurrentRoom(socket, true);
      break;
    case "U":
      handleUpdate(socket, raw);
      break;
    case "A":
      handleAll(socket, raw);
      break;
    case "P":
      socket.emit("message", "P");
      break;
    case "V":
      handleVote(socket, raw);
      break;
    case "K":
      handleKnockResponse(socket, raw);
      break;
    default:
      // Unknown command: ignore.
      break;
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/*
 **  E|name|location|auth|link|room|userId|privacy|key|specs
 **
 **  Only the key field may legitimately contain a vertical bar (the user can
 **  type one into a private-room key). Because specs is always the final field,
 **  everything between "privacy" and the last field is treated as the key.
 */
function handleEnter(socket, raw) {
  const parts = raw.split("|");
  if (parts.length < 8) {
    return;
  }

  const nameClean = sanitizeDisplay(clampLen(parts[1] || "", MAX_NAME_LEN));
  const locClean = sanitizeDisplay(clampLen(parts[2] || "", MAX_LOC_LEN));
  const auth = parts[3] === "Facebook" ? "Facebook" : "";
  const link = sanitizeLink(parts[4] || "");
  const roomName = sanitizeDisplay(clampLen(parts[5] || "", MAX_ROOM_LEN));
  const userId = clampLen(parts[6] || "", 64);
  const privacyRaw = toIntField(parts[7], PRIVACY_PUBLIC);
  const privacy =
    privacyRaw === PRIVACY_PRIVATE || privacyRaw === PRIVACY_SEMIPRIVATE
      ? privacyRaw
      : PRIVACY_PUBLIC;

  // specs is the final field; the key is everything in between (pipe-safe).
  const specs = parts[parts.length - 1] === "v" ? "v" : "h";
  const providedKey = clampLen(
    parts.slice(8, parts.length - 1).join("|"),
    MAX_KEY_LEN,
  );

  if (!nameClean || !roomName || !userId) {
    return; // malformed / incomplete identity
  }

  // Leave any room this socket was previously in (defensive against races).
  leaveCurrentRoom(socket, false);

  let room = rooms.get(roomName);
  const isNewRoom = !room;

  if (isNewRoom) {
    if (rooms.size >= MAX_ROOMS) {
      socket.emit("message", "W|full");
      return;
    }
    // The creator becomes the host and fixes the room's settings.
    room = new Room(
      roomName,
      privacy,
      specs,
      privacy === PRIVACY_PRIVATE ? providedKey : "",
    );
    rooms.set(roomName, room);
  }

  // Permanent rooms are always public regardless of what a client requests.
  if (room.permanent) {
    room.privacy = PRIVACY_PUBLIC;
  }

  const identity = identityOf(nameClean, locClean);

  // If this same browser (userId) is already seated here, free the old seat
  // first. This makes page refreshes clean instead of tripping the dup check.
  const existingSlot = room.slotOfUserId(userId);
  if (existingSlot !== -1) {
    vacateSlot(room, existingSlot);
  }

  // Access control (skipped for the host who just created the room).
  if (!isNewRoom && room.privacy !== PRIVACY_PUBLIC) {
    if (!room.unlocks(providedKey, identity)) {
      socket.emit("message", "W|key");
      return;
    }
  }

  if (room.isFull()) {
    socket.emit("message", "W|full");
    return;
  }

  // Reject a duplicate name+location already present in the room.
  for (const occ of room.occupants()) {
    if (occ.nameClean === nameClean && occ.locClean === locClean) {
      socket.emit("message", "W|dup");
      return;
    }
  }

  const slot = room.firstFreeSlot();
  const user = {
    socketId: socket.id,
    userId,
    nameClean,
    locClean,
    auth,
    link,
    roomName,
    slot,
  };

  room.addUser(user, slot);
  users.set(socket.id, user);
  socket.join(roomChannel(roomName));

  // A satisfied semi-private guest no longer needs to be in the pending queue.
  if (room.privacy === PRIVACY_SEMIPRIVATE) {
    room.pending.delete(identity);
    notifyHost(room);
  }

  // Tell the newcomer their slot and the room settings.
  socket.emit("message", `W|${slot}`);
  socket.emit("message", `R|${room.host}|${room.privacy}`);

  // Announce the newcomer to everyone already in the room. Each of them replies
  // with an "A" snapshot, which is how the newcomer learns the existing talkers.
  socket
    .to(roomChannel(roomName))
    .emit("message", `E|${slot}|${nameClean}|${locClean}|${auth}|${link}`);
}

/*
 **  U|deleteChars|changeIndex|newText  - relay an incremental edit to the room.
 */
function handleUpdate(socket, raw) {
  const user = users.get(socket.id);
  if (!user) {
    return;
  }
  const parts = raw.split("|");
  const deleteChars = toIntField(parts[1], 0);
  const changeIndex = toIntField(parts[2], 0);
  const newText = clampLen(parts.slice(3).join("|"), MAX_TEXT_LEN);

  socket
    .to(roomChannel(user.roomName))
    .emit("message", `U|${user.slot}|${deleteChars}|${changeIndex}|${newText}`);
}

/*
 **  A|text  - the sender's full text. Re-broadcast with the sender's (server-held,
 **  already-sanitised) identity so the rest of the room gets a complete snapshot.
 */
function handleAll(socket, raw) {
  const user = users.get(socket.id);
  if (!user) {
    return;
  }
  const text = clampLen(raw.substring(2), MAX_TEXT_LEN); // everything after "A|"
  socket
    .to(roomChannel(user.roomName))
    .emit(
      "message",
      `A|${user.slot}|${user.nameClean}|${user.locClean}|${user.auth}|${user.link}|${text}`,
    );
}

/*
 **  V|direction|slot  - a talker up/down votes another slot. When a majority of
 **  the OTHER occupants have a standing down-vote against a slot, that talker is
 **  expelled (sent Z; the rest of the room sees them leave normally).
 */
function handleVote(socket, raw) {
  const user = users.get(socket.id);
  if (!user) {
    return;
  }
  const room = rooms.get(user.roomName);
  if (!room) {
    return;
  }
  const parts = raw.split("|");
  const direction = parts[1];
  const targetSlot = toIntField(parts[2], -1);
  const target = room.userAt(targetSlot);
  if (!target || targetSlot === user.slot) {
    return; // can't vote for an empty slot or for yourself
  }

  let voters = room.downVotes.get(targetSlot);
  if (!voters) {
    voters = new Set();
    room.downVotes.set(targetSlot, voters);
  }

  if (direction === "-") {
    voters.add(user.userId);
  } else if (direction === "+") {
    voters.delete(user.userId);
  } else {
    return;
  }

  // Majority of the others (everyone except the target).
  const others = room.occupantCount() - 1;
  if (others >= 2 && voters.size > others / 2) {
    expel(room, targetSlot);
  }
}

/*
 **  K|direction|name|location  - a semi-private host grants(+) or denies(-) a
 **  pending access request. On a grant we mint a one-off key for that identity;
 **  the guest picks it up via /roominfo.json and uses it to enter.
 */
function handleKnockResponse(socket, raw) {
  const user = users.get(socket.id);
  if (!user) {
    return;
  }
  const room = rooms.get(user.roomName);
  if (!room || room.privacy !== PRIVACY_SEMIPRIVATE) {
    return;
  }
  if (room.host !== user.slot) {
    return; // only the host may answer knocks
  }

  const parts = raw.split("|");
  const direction = parts[1];
  const name = sanitizeDisplay(clampLen(parts[2] || "", MAX_NAME_LEN));
  const loc = sanitizeDisplay(clampLen(parts[3] || "", MAX_LOC_LEN));
  const identity = identityOf(name, loc);

  if (!room.pending.has(identity)) {
    return;
  }
  room.pending.delete(identity);

  if (direction === "+") {
    room.grants.set(identity, mintGrantKey());
  }
  notifyHost(room);
}

// ---------------------------------------------------------------------------
// Semi-private access requests (the "knock knock" queue)
// ---------------------------------------------------------------------------

function registerAccessRequest(roomName, name, loc) {
  const room = rooms.get(roomName);
  if (!room || room.privacy !== PRIVACY_SEMIPRIVATE) {
    return;
  }
  const cleanName = sanitizeDisplay(clampLen(name, MAX_NAME_LEN));
  const cleanLoc = sanitizeDisplay(clampLen(loc, MAX_LOC_LEN));
  const identity = identityOf(cleanName, cleanLoc);
  if (room.grants.has(identity) || room.pending.has(identity)) {
    return; // already granted or already queued
  }
  // Someone already seated under this identity does not need to knock.
  if (
    room
      .occupants()
      .some((o) => identityOf(o.nameClean, o.locClean) === identity)
  ) {
    return;
  }
  room.pending.set(identity, { name: cleanName, loc: cleanLoc });
  notifyHost(room);
}

// Push the current pending-request list to a semi-private room's host.
function notifyHost(room) {
  const hostSocketId = room.hostSocketId();
  if (!hostSocketId) {
    return;
  }
  const lines = [];
  for (const req of room.pending.values()) {
    lines.push(`${req.name}|${req.loc}`);
  }
  io.to(hostSocketId).emit("message", `K|${room.host}|${lines.join("\n")}`);
}

// ---------------------------------------------------------------------------
// Departures & expulsions
// ---------------------------------------------------------------------------

function roomChannel(roomName) {
  return "room:" + roomName;
}

// Remove the occupant of a slot and tell the rest of the room they left.
function vacateSlot(room, slot) {
  const leaving = room.userAt(slot);
  if (!leaving) {
    return;
  }
  room.removeSlot(slot);
  users.delete(leaving.socketId);
  const sock = io.sockets.sockets.get(leaving.socketId);
  if (sock) {
    sock.leave(roomChannel(room.name));
  }
  io.to(roomChannel(room.name)).emit("message", `X|${slot}`);
}

// Handle a socket leaving its room, whether by an explicit X, a disconnect,
// or re-entry. When `redirect` is true the client is also told to go home (Z).
function leaveCurrentRoom(socket, redirect) {
  const user = users.get(socket.id);
  if (!user) {
    return;
  }
  const room = rooms.get(user.roomName);
  users.delete(socket.id);

  if (room) {
    const slot = user.slot;
    if (room.userAt(slot) === user) {
      room.removeSlot(slot);
      socket.to(roomChannel(room.name)).emit("message", `X|${slot}`);
      notifyHost(room); // host may have changed
    }
    reapRoomIfEmpty(room);
  }

  socket.leave(roomChannel(user.roomName));
  if (redirect) {
    socket.emit("message", "Z");
  }
}

// Expel the talker in a slot: send them to the lobby and free their seat.
function expel(room, slot) {
  const target = room.userAt(slot);
  if (!target) {
    return;
  }
  const sock = io.sockets.sockets.get(target.socketId);
  users.delete(target.socketId);
  room.removeSlot(slot);

  io.to(roomChannel(room.name)).emit("message", `X|${slot}`);
  if (sock) {
    sock.leave(roomChannel(room.name));
    sock.emit("message", "Z");
  }
  notifyHost(room);
  reapRoomIfEmpty(room);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// HOST is left undefined by default (listen on all interfaces, convenient for
// local development). Behind a reverse proxy, set HOST=127.0.0.1 so the app is
// only reachable through the proxy.
const HOST = process.env.HOST || undefined;

server.listen(PORT, HOST, () => {
  console.log("=====================================");
  console.log(" Talkomatic server is running");
  console.log(`   http://${HOST || "localhost"}:${PORT}`);
  console.log("=====================================");
});

module.exports = { app, server, io };
