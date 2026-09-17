import { createGame, ROLES } from './game.js';
import { recordGame } from './stats.js';

/*
 * One Durable Object == one game, and there can now be as many as people care
 * to start: the Worker addresses this object by the room id in `?g=`, and the
 * Lobby object hands that id out. The game itself is unchanged - it was already
 * a self-contained createGame() with no idea anything else existed.
 *
 * The Python handler held threading.Lock around every mutation. That is gone:
 * handle() is synchronous JavaScript, so a command runs to completion before
 * anything else observes the state. Only the long-poll actually awaited, and
 * that is now a promise woken by flush() instead of a Condition.
 */

const POLL_SECONDS = 25;

/* A room with no command in this long is over. Nobody can say so explicitly -
   the client is an HTTP long-poll, not a socket, so there is no disconnect to
   listen for - which is why the quest counts its abandons on a timer. */
const IDLE_MS = 20 * 60 * 1000;

/* A quest already under way is private. A second player is announced to whoever
   is in it, and only gets in if they answer YES. If nobody answers in this long
   the traveller is turned away rather than left hanging. */
const ASK_TIMEOUT_MS = 90 * 1000;

/* Cloudflare's guess at where the caller is, as a country name. Arrives as a
   header because `request.cf` does not survive the hop into this object. */
function countryOf(request) {
  const cc = (request.headers.get('X-Player-Country') || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return 'parts unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || cc;
  } catch {
    return cc;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.g = createGame();
    this.roomId = '';
    // session bookkeeping for the operator stats
    this.started = 0;        // epoch ms of the first join, 0 while unplayed
    this.lastActivity = Date.now();
    this.recorded = false;   // this game has already been written to Stats
    // the traveller currently knocking: {role, token, country, at, answer}
    this.ask = null;
    this.refused = new Map();  // token -> when they were turned away
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    this.roomId = url.searchParams.get('g') || this.roomId;
    this.lastActivity = Date.now();

    if (request.method === 'GET' && path === '/api/events') return this.events(url);
    if (request.method === 'POST' && path === '/api/join') return this.join(request);
    if (request.method === 'POST' && path === '/api/cmd') return this.cmd(request);
    return json({ error: 'not found' }, 404);
  }

  /* Entries visible to `role`. Every entry is stored with to:null -- the
     filter is kept because the original had it. */
  visible(role, since = -1) {
    return this.g.state.log.filter(
      (e) => e.id > since && (e.to === null || e.to === role));
  }

  async events(url) {
    const role = url.searchParams.get('role') || '';
    const token = url.searchParams.get('token') || '';
    const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    if (!(role in ROLES) || this.g.state.tokens[role] !== token) {
      return json({ error: 'bad session' }, 403);
    }

    const deadline = Date.now() + POLL_SECONDS * 1000;
    while (this.g.state.version <= since && Date.now() < deadline) {
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      });
      await Promise.race([this.g.onChange(), timeout]);
      clearTimeout(timer);
    }
    return json({
      version: this.g.state.version,
      entries: this.visible(role, since),
      sidebar: this.g.sidebar(),
    });
  }

  async join(request) {
    const data = await request.json().catch(() => ({}));
    const role = data.role || '';
    const token = data.token || '';
    if (!(role in ROLES)) return json({ error: 'unknown character' }, 400);

    this.expireAsk();

    const held = this.g.state.tokens[role];
    if (held !== undefined && held !== token) {
      return json({ error: `${ROLES[role].name} is already being played on another device.` }, 409);
    }

    /* Reclaiming your own character after a reload is not a stranger arriving,
       and an empty room has nobody to ask - both go straight in. */
    const occupied = Object.keys(this.g.state.tokens).length > 0;
    if (held === undefined && occupied) {
      const held_up = this.knock(role, token, countryOf(request));
      if (held_up) return held_up;
    }

    const fresh = held === undefined;
    if (fresh) {
      this.g.state.tokens[role] = token;
      this.g.emit(`⭐ ${ROLES[role].emoji} ${ROLES[role].name} wades ashore ` +
                  'and joins the quest!', null, 'move');
      if (Object.keys(this.g.state.tokens).length === 2) {
        this.g.emit("You're both here. The wedding is at dawn — try 'look' to " +
                    "get your bearings. ('help' lists every command; 'hint' if " +
                    "you're stuck.)", null, 'sys');
      }
    }
    // the knock-and-answer lines are a doorstep exchange, not story: replaying
    // them to whoever just walked in would read very strangely
    const entries = this.visible(role).filter((e) => e.cls !== 'ask').slice(-150);
    this.g.flush();
    if (!this.started) this.started = Date.now();
    await this.touch();
    return json({
      ok: true,
      version: this.g.state.version,
      entries,
      sidebar: this.g.sidebar(),
      intro: this.g.describeRoom(),
    });
  }

  async cmd(request) {
    const data = await request.json().catch(() => ({}));
    const role = data.role || '';
    const token = data.token || '';
    const text = String(data.text ?? '').slice(0, 300);
    if (!(role in ROLES) || this.g.state.tokens[role] !== token) {
      return json({ error: 'bad session' }, 403);
    }

    /* With somebody knocking, YES and NO are the answer to them rather than
       commands for the game. Nothing is intercepted at any other time, so the
       verbs stay free for the story. */
    this.expireAsk();
    const answer = text.trim().toLowerCase();
    if (this.ask && !this.ask.answer && ['yes', 'y', 'no', 'n'].includes(answer)) {
      /* No `›` echo for this one: the answer is to the door, not a move in the
         game, and the confirmation below already says what happened. Echoing it
         would also replay "Alexander: YES" as the first line the newcomer
         reads. */
      const letThemIn = answer[0] === 'y';
      if (letThemIn) {
        this.ask.answer = 'yes';
        this.g.emit('You wave the traveller over. They are wading ashore now.',
                    null, 'ask');
      } else {
        this.refused.set(this.ask.token, Date.now());
        this.ask = null;
        this.g.emit('You send the traveller on their way. The quest stays yours.',
                    null, 'ask');
      }
      this.g.flush();
      await this.touch();
      return json({ ok: true });
    }

    this.g.emit(`› ${ROLES[role].name}: ${text}`, null, 'echo');
    this.g.handle(role, text);
    this.g.flush();
    if (this.g.state.won) this.finish('win');
    if (this.g.state.resetRequested) this.reset();
    await this.touch();
    return json({ ok: true });
  }

  /* Replace the game with a fresh one, continuing the version counter so that
     clients already long-polling at `since=N` still see what comes next. The
     old game's waiters were just released by flush(), and dropping the object
     leaves nothing behind. */
  reset() {
    this.finish('abandoned');
    const carry = this.g.state.version;
    this.g = createGame(carry);
    this.g.flush();
    this.started = Date.now();
    this.recorded = false;
    // a fresh quest is nobody's yet, so old refusals should not follow it
    this.ask = null;
    this.refused.clear();
  }

  /* ---- the doorstep ------------------------------------------------------ */

  /* Returns a Response while the traveller is still outside — 202 keep waiting,
     403 turned away, 409 somebody else is already knocking — and null once the
     player inside has said yes, which lets join() carry on and seat them. The
     newcomer's client simply re-POSTs /api/join until it stops getting 202. */
  knock(role, token, country) {
    if (this.refused.has(token)) {
      return json({ error: 'The player already on that quest turned you away.', refused: true }, 403);
    }
    const p = this.ask;
    if (p && p.token === token) {
      if (p.answer === 'yes') { this.ask = null; return null; }
      return json({ waiting: true, country: p.country }, 202);
    }
    if (p) {
      return json({ error: 'Another traveller is already knocking at that quest.', busy: true }, 409);
    }

    this.ask = { role, token, country, at: Date.now(), answer: null };
    this.g.emit(`Ahh!  Someone from ${country} wants to join you on your quest!  ` +
                'Let them join you?  (type YES or NO)', null, 'ask');
    this.g.flush();
    return json({ waiting: true, country }, 202);
  }

  expireAsk() {
    if (this.ask && !this.ask.answer && Date.now() - this.ask.at > ASK_TIMEOUT_MS) {
      this.refused.set(this.ask.token, Date.now());
      this.ask = null;
      this.g.emit('The traveller waited a while, then carried on down the beach.',
                  null, 'ask');
      this.g.flush();
    }
    if (this.refused.size > 50) {
      const cutoff = Date.now() - ASK_TIMEOUT_MS * 10;
      for (const [t, at] of this.refused) if (at < cutoff) this.refused.delete(t);
    }
  }

  /* ---- bookkeeping ------------------------------------------------------ */

  /* Writes this game's result exactly once. A quest that is walked away from
     rather than finished lands here too, from the idle alarm. */
  finish(outcome) {
    if (this.recorded || !this.started) return;
    this.recorded = true;
    recordGame(this.env, this.ctx, {
      seconds: Math.round((this.lastActivity - this.started) / 1000),
      outcome,
      winner: outcome === 'win' ? 'party' : null,
      players: Object.keys(this.g.state.tokens).length,
      detail: {
        room: this.roomId,
        location: this.g.state.location,
        solved: this.g.sidebar().checklist.filter(([, done]) => done).length,
      },
    });
  }

  /* Tells the Lobby who is in the room and pushes the idle alarm back.
     `lastActivity` is stamped earlier, in fetch(), so a win recorded during this
     request measures up to the command that won it. */
  async touch() {
    await this.reportLobby(false);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  async reportLobby(gone) {
    if (!this.roomId || !this.env.LOBBY) return;
    const t = this.g.state.tokens;
    await this.env.LOBBY.get(this.env.LOBBY.idFromName('main')).fetch(
      'https://lobby/internal/report',
      {
        method: 'POST',
        body: JSON.stringify({
          room: this.roomId,
          gone,
          alexander: t.alexander !== undefined,
          jollo: t.jollo !== undefined,
        }),
      });
  }

  /* The only way an unfinished quest ever gets counted. Note `started` is
     in-memory: if this object was evicted the game is gone anyway, so there is
     nothing to record and the alarm's one job is to clear the Lobby row. */
  async alarm() {
    const idle = Date.now() - this.lastActivity;
    if (this.started && idle < IDLE_MS) {
      await this.ctx.storage.setAlarm(Date.now() + (IDLE_MS - idle));
      return;
    }
    this.finish('abandoned');
    this.started = 0;
    await this.reportLobby(true);
  }
}
