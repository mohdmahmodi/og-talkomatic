# Talkomatic Server

A self-contained Node.js + [Socket.IO](https://socket.io/) server that speaks
the wire protocol used by the original Talkomatic browser client. It works with
both the **classic (v3)** client (`lobby.js` / `talko.js`) and the **new (v4)**
client (`lobby_en.js` / `talko_en.js`).

All state is in memory. No chat content is ever stored.

## Run

```bash
npm install
npm start            # listens on http://localhost:4001
```

Port resolution order: the `PORT` environment variable, then a `--port <n>`
flag, then `4001`.

## HTTP endpoints

| Route                | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `GET /`              | Entry page (`index.html`)                                      |
| `GET /index`         | Entry page for invite links: `/index?r=<zvvy-encoded room>`    |
| `GET /roominfo.json` | Live room list for the lobby (JSON), honouring privacy + keys  |
| `GET /<asset>`       | Static client files (HTML/CSS/JS/images/sounds)                |

`GET /server/*` is blocked (the server source is never served), and the
Socket.IO client is served by Socket.IO itself at `/socket.io/socket.io.js`.

### `/roominfo.json` query parameters

All values are ZvvyCode-encoded by the client (plain values also work).

| Param     | Meaning                                                              |
| --------- | ------------------------------------------------------------------- |
| `key`     | Private-room key; reveals that room's occupant list                 |
| `unc`/`ulc` | The viewer's cleaned name / location (identity for semi-private)   |
| `reqRoom` | A semi-private room the viewer is requesting access to (a "knock")  |
| `SPRkey`  | A semi-private grant key the viewer holds (informational)           |

The response maps each room name to an object: an `info>` entry holding
`{ privacy, specs, host, currentKey? }` plus one `name: location` pair per
visible occupant.

## Socket.IO message protocol

Messages are pipe-delimited strings sent on the `message` event.

**Client → Server**

| Message                                          | Meaning                          |
| ------------------------------------------------ | -------------------------------- |
| `E\|name\|loc\|auth\|link\|room\|userId\|privacy\|key\|specs` | Enter a room          |
| `X`                                              | Leave the room                   |
| `U\|deleteChars\|changeIndex\|newText`           | Incremental text edit            |
| `A\|text`                                        | Full text (reply to an entry)    |
| `P`                                              | Heartbeat                        |
| `V\|direction\|slot`                             | Up/down vote a talker (`+`/`-`)  |
| `K\|direction\|name\|loc`                        | Host grants (`+`) / denies (`-`) |

**Server → Client**

| Message                                    | Meaning                                   |
| ------------------------------------------ | ----------------------------------------- |
| `W\|slot`                                  | Slot assignment (entry succeeded)         |
| `W\|full` · `W\|key` · `W\|dup`            | Entry rejected                            |
| `R\|hostSlot\|privacy`                     | Room info, sent right after entry         |
| `E\|slot\|name\|loc\|auth\|link`           | Another talker entered                    |
| `X\|slot`                                  | A talker left                             |
| `U\|slot\|del\|index\|text`                | Another talker's text edit                |
| `A\|slot\|name\|loc\|auth\|link\|text`     | Full snapshot of another talker           |
| `P`                                        | Heartbeat reply                           |
| `Z`                                        | Return to the lobby (kicked / expelled)   |
| `K\|hostSlot\|name\|loc\n…`                | Pending access requests (to a host)       |

When a talker enters, the server notifies the others; each replies with an `A`
snapshot, which is how the newcomer learns who is already present.

## Rooms & privacy

* **5 slots** per room. The first to enter becomes the **host**; if the host
  leaves, the role passes to the lowest remaining slot.
* **Permanent public rooms** (`Hangout 247`, `CERL165A-B`, `Cyber1`) always
  exist and are never deleted.
* **Privacy levels:**
  * `0` **public**: always listed, occupants visible.
  * `1` **semi-private**: listed with occupants visible, but each guest must be
    approved by the host. A knock (`reqRoom`) queues a request. On a `K|+` grant
    the server mints a one-time key, which the guest receives via
    `/roominfo.json` and presents on entry.
  * `2` **private**: listed, but occupants are hidden until the requester
    supplies the matching `key`.
* **Voting**: `V|-|slot` registers a down-vote. When a majority of the *other*
  occupants down-vote a talker, that talker is expelled (`Z`).

## Safety

* All identity fields are length-capped and HTML-escaped server-side, so a
  malicious client cannot inject markup into other people's screens.
* Profile links are restricted to `http(s)` URLs.
* Per-connection message rate limiting and a maximum message size guard against
  flooding; the number of simultaneous rooms is capped.

## Environment variables

* `PORT`: server port (default `4001`).
* `HOST`: address to bind (default all interfaces; set `127.0.0.1` behind a proxy).
