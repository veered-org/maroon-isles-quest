export { Room } from './room.js';
export { Lobby } from './lobby.js';
export { Stats } from './stats.js';

import { statsFetch } from './stats.js';

/*
 * Worker entry point.
 *
 * There used to be one Durable Object holding the one game. Now there is a Room
 * per game, addressed by the `g` parameter every /api call carries, plus two
 * singletons: the Lobby that hands arrivals a room, and Stats that records
 * finished games for the operator stats.
 *
 * `g` is a query parameter rather than something in the body because /api/join
 * and /api/cmd are POSTs: reading the body here to find the room would consume
 * the stream before the Durable Object ever saw it.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/match') {
      return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch(request);
    }

    if (path === '/api/stats') {
      return statsFetch(env, request, url);
    }

    if (path.startsWith('/api/')) {
      const room = (url.searchParams.get('g') || '').slice(0, 32);
      if (!/^[a-z0-9]{4,32}$/.test(room)) {
        return new Response(JSON.stringify({ error: 'no game specified' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      /* `request.cf` is not carried across a Durable Object fetch, so the
         edge's guess at where the caller is has to be copied into a header
         here. It is what names the country in the "someone wants to join"
         prompt. */
      const headers = new Headers(request.headers);
      headers.set('X-Player-Country', (request.cf && request.cf.country) || '');
      return env.ROOM.get(env.ROOM.idFromName(room))
        .fetch(new Request(request, { headers }));
    }

    return env.ASSETS.fetch(request);
  },
};
