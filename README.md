# Maroon Isles Quest: Two-Player Co-op Text Adventure

*Why Maroon? The deep red of an island adventure.*

**Play it now: [quest.veered.org](https://quest.veered.org)** · more games at [veered.org](https://veered.org)

![Maroon Isles Quest](docs/screenshot.jpg)

Maroon Isles Quest is a **parody game, built as a proof of concept**. It borrows the
setting of a classic 1990s adventure game and plays it for laughs ("Hair Today, Bald
Tomorrow"). The point is to test a new kind of text adventure. It is not affiliated with
or endorsed by the owners of the original game.

## Please test before relying on it

This is shared as-is, with no warranty. It works on my own computers, but your system,
settings and software versions may differ, so please try it in a safe setting first.
If something doesn't work, you can ask Claude (or another AI coding assistant) to look
into it, and I'd appreciate hearing what you found and how you fixed it. You are also
welcome to just let me know at support@veered.org, and I'll look into it.

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
- **Nothing to install and no accounts.** It runs entirely in the browser, served from
  your company or a ~$10/yr account from Cloudflare.

Type `help` in the game for the command list, and `newgame` to start over after a win.

## Put your own copy on the internet

You do not have to be a programmer, and it costs nothing to start. The game is hosted
by Cloudflare, who will run something this small for free; a domain name of your own is
about $10 a year if you want one.

1. **Get the game.** Download the source (the button at the top of this page) and unzip
   it. You now have a folder called `maroon-isles-quest`.
2. **Open a free Cloudflare account** at
   [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). An email address
   and a password; no card needed.
3. **Install Node.js** from [nodejs.org](https://nodejs.org) — take the version it
   offers — and install it like any other program. This is what does the uploading.
4. **Open a terminal** in that folder (on Windows, right-click the folder and choose
   "Open in Terminal"; on a Mac, Terminal) and type these two lines, one at a time:

```bash
npm install
npx wrangler deploy
```

The first line collects the pieces the game needs. The second signs you in to
Cloudflare in a browser window, then prints a web address ending in `workers.dev` —
that is your copy. Send the link to the person you want to play with.

To try it on your own computer first, type `npx wrangler dev` instead and open
`http://localhost:8787` in two tabs. If something goes wrong, paste the error into
Claude and ask what it means; that is the fastest way through it.

## Information for nerds

- **Server:** a Cloudflare Worker with Durable Objects (`src/`).
  - `Room`: one Durable Object per quest, addressed by `?g=<room>` on every `/api` call.
    It runs the game engine (`src/game.js`) and serves a long-poll event stream.
  - `Lobby`: one instance that matches arrivals to a quest with a free character.
    A quest already under way asks the player inside before letting a second one join.
  - `Stats`: one row per finished or abandoned quest, readable at
    `/api/stats?key=STATS_KEY&days=N`.
- **Client:** a single self-contained page (`public/index.html`). Scene art and the map
  are inline SVG. Voices use the browser's Web Speech API.
- **Requirements:** Node.js 22 or later.
- **Optional settings:** `cp .dev.vars.example .dev.vars` for local runs; `STATS_KEY` is
  set in production with `npx wrangler secret put STATS_KEY`.
- **Your own hostname:** uncomment the `[[routes]]` block in `wrangler.toml` and deploy
  again.

## Credits and licenses

- Code: MIT. See [LICENSE](LICENSE).
- No third-party art, fonts or sound files are included. Scene illustrations are
  drawn in code, and speech uses the voices built into the browser.
- Maroon Isles Quest was written with AI assistance (Claude).
