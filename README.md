# Maroon Isles Quest

**Play it now: [quest.veered.org](https://quest.veered.org)** · more games at [veered.org](https://veered.org)

![Maroon Isles Quest](docs/screenshot.jpg)

Maroon Isles Quest is a **parody game, built as a proof of concept**. It borrows the
setting of a classic 1990s adventure game and plays it for laughs ("Hair Today, Bald
Tomorrow"). The point is to test a new kind of text adventure. It is not affiliated with
or endorsed by the owners of the original game.

## What's new in it

- **A text adventure for two players at once, over the internet.** Classic text
  adventures are single-player. Here, two people join the same quest from their own
  browsers, and both see every move and every line of the story as it happens.
- **You have to work together.** Each player is a different character with different
  abilities: Alexander is the strong one, Jollo is small and quick. Some obstacles only
  one of you can get past. Others need both at the same moment: both players type
  `together <action>`, and it only works when both do.
- **Voices, both ways.** A narrator reads the scenes aloud, and each character speaks
  with their own voice. You can also speak your commands instead of typing them.
- **Pictures and a map in a text game.** Locations have their own illustrations, and a
  map of the islands sits beside the story. All are drawn in code, so there are no image
  files.
- **Joining is by consent.** A stranger is matched into a quest with a free character,
  but a quest already under way is private. The player inside is asked ("Someone from
  Canada wants to join you on your quest! Let them join you?") and answers yes or no.
- **Nothing to install and no accounts.** It runs entirely in the browser, on a small
  serverless back end (Cloudflare Durable Objects), so it costs almost nothing to host.

## How it works

- **Server:** a Cloudflare Worker with Durable Objects (`src/`).
  - `Room`: one Durable Object per quest, addressed by `?g=<room>` on every `/api` call.
    It runs the game engine (`src/game.js`) and serves a long-poll event stream.
  - `Lobby`: one instance that matches arrivals to a quest with a free character.
    A quest already under way asks the player inside before letting a second one join.
  - `Stats`: one row per finished or abandoned quest, readable at
    `/api/stats?key=STATS_KEY&days=N`.
- **Client:** a single self-contained page (`public/index.html`). Scene art and the map
  are inline SVG. Voices use the browser's Web Speech API.

Type `help` in the game for the command list, and `newgame` to start over after a win.

## Run it yourself

Requires Node.js 22 or later.

```bash
npm install
cp .dev.vars.example .dev.vars   # optional
npx wrangler dev                 # then open http://localhost:8787 in two tabs
```

To deploy to your own Cloudflare account, run `npx wrangler deploy`. To serve it on
your own hostname, uncomment the `[[routes]]` block in `wrangler.toml`. The optional
`STATS_KEY` is set in production with `npx wrangler secret put STATS_KEY`.

## Credits and licenses

- Code: MIT. See [LICENSE](LICENSE).
- No third-party art, fonts or sound files are included. Scene illustrations are
  drawn in code, and speech uses the voices built into the browser.
- Maroon Isles Quest was written with AI assistance (Claude).
