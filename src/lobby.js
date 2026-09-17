/*
 * Matchmaker for the quest.
 *
 * The game used to be one global Durable Object, so two people were always in
 * the same story and a third was turned away. Now every game is its own Room
 * object and this Lobby is the only shared one: it knows which rooms exist and
 * which of the two characters each still has free, so an arrival can be pointed
 * at the first room with a part going.
 *
 * The Room stays authoritative about who holds what. This table is a hint that
 * can go stale (a Room evicted for being idle comes back empty and forgets its
 * tokens), so a client that is refused simply asks for another match, telling
 * us which room let it down.
 */

const ROLES = ['alexander', 'jollo'];

/* A room nobody has reported in this long is presumed finished. Its Durable
   Object has almost certainly been evicted by then, which resets the game
   anyway, so keeping the row would only send someone into an empty story. */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

export class Lobby {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      alexander INTEGER NOT NULL DEFAULT 0,
      jollo INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL
    )`);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/match') {
      const body = await request.json().catch(() => ({}));
      return json(this.match(String(body.avoid || '')));
    }
    if (request.method === 'POST' && url.pathname === '/internal/report') {
      const body = await request.json().catch(() => ({}));
      this.report(body);
      return new Response('ok');
    }
    if (url.pathname === '/internal/rooms') {
      this.prune();
      return json({ rooms: this.sql.exec('SELECT * FROM rooms ORDER BY updated').toArray() });
    }
    return json({ error: 'not found' }, 404);
  }

  /* First room with a free character, preferring one that already has somebody
     waiting in it - otherwise everybody would sit alone in a room of their own
     and never meet. `avoid` is the room that just refused this client. */
  match(avoid) {
    this.prune();
    const rows = this.sql.exec(
      `SELECT id, alexander, jollo FROM rooms
       WHERE alexander = 0 OR jollo = 0
       ORDER BY (alexander + jollo) DESC, updated ASC`).toArray();

    for (const r of rows) {
      if (r.id === avoid) continue;
      const role = r.alexander ? 'jollo' : 'alexander';
      return { room: r.id, role, fresh: false };
    }

    const id = newRoomId();
    this.sql.exec('INSERT INTO rooms (id, alexander, jollo, updated) VALUES (?, 0, 0, ?)',
      id, Date.now());
    return { room: id, role: 'alexander', fresh: true };
  }

  /* Rooms tell us who is in them after every join and every reset, and tell us
     they are over when they go idle. */
  report(b) {
    const id = String(b.room || '');
    if (!id) return;
    if (b.gone) {
      this.sql.exec('DELETE FROM rooms WHERE id = ?', id);
      return;
    }
    this.sql.exec(
      `INSERT INTO rooms (id, alexander, jollo, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET alexander = excluded.alexander,
                                     jollo = excluded.jollo,
                                     updated = excluded.updated`,
      id, b.alexander ? 1 : 0, b.jollo ? 1 : 0, Date.now());
  }

  prune() {
    this.sql.exec('DELETE FROM rooms WHERE updated < ?', Date.now() - ROOM_TTL_MS);
  }
}

/* Short and unambiguous: no vowels, so it cannot spell anything, and no 0/1/i/l
   to be misread if it is ever repeated out loud. */
function newRoomId() {
  const alphabet = '23456789bcdfghjkmnpqrstvwxyz';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export { ROLES };
