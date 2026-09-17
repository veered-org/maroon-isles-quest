/*
 * Maroon Isles Quest - game logic, translated from an earlier Python server.
 *
 * A straight port of the Python `Game` class plus its module-level data
 * tables. Every string, branch order and flag name was preserved, and the port
 * was checked by diffing a scripted playthrough against the Python original.
 *
 * What is gone, and why it is safe:
 *   - threading.Lock / Condition. A Durable Object processes one request at a
 *     time, so the mutual exclusion the lock provided is inherent. `flush()`
 *     survives as the long-poll wakeup and nothing else.
 *   - The `to` argument to emit(). The original already ignored it (every entry
 *     is stored with to:null so both screens stay identical); it is kept at the
 *     call sites purely for readability, exactly as in the Python.
 *
 * Iteration order matters in two places -- the examine table and MAP_DESTS are
 * scanned for the first substring match -- so both are arrays of pairs rather
 * than objects, to make the ordering explicit rather than incidental.
 */

export const ROLES = {
  alexander: {
    name: 'Alexander',
    emoji: '👑',
    blurb: 'Prince of Daventry. Strong and determined. Carries the royal ' +
           'signet ring. Came across the sea for Princess Cassima.',
  },
  jollo: {
    name: 'Jollo',
    emoji: '🎭',
    blurb: 'The castle clown of the Maroon Isles. Small, nimble, and ' +
           'quick-fingered. Loyal to Princess Cassima.',
  },
};

const ROOMS = {
  beach: { name: 'Shipwreck Beach', exits: { east: 'village' } },
  village: { name: 'Village of the Crown', exits: { west: 'beach', north: 'gate' } },
  gate: { name: 'Castle Gate', exits: { south: 'village' } },
  wonder: { name: 'Isle of Wonder', exits: {} },
  cliffs: { name: 'Cliffs of Logic', exits: { up: 'summit', north: 'catacombs' } },
  summit: { name: 'Sacred Mountain Summit', exits: { down: 'cliffs' } },
  catacombs: { name: 'Catacombs', exits: { south: 'cliffs', north: 'cellar' } },
  cellar: { name: 'Castle Cellars', exits: { down: 'catacombs', up: 'throne' } },
  throne: { name: 'Throne Room', exits: { down: 'cellar' } },
};

const DIR_WORDS = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  up: 'up', down: 'down',
};

// where the magic map works, and where it can take you
const MAP_SPOTS = new Set(['beach', 'village', 'gate', 'wonder', 'cliffs']);
const MAP_DESTS = [
  ['crown', ['village', 'Isle of the Crown']],
  ['wonder', ['wonder', 'Isle of Wonder']],
  ['sacred', ['cliffs', 'Isle of the Sacred Mountain']],
  ['mountain', ['cliffs', 'Isle of the Sacred Mountain']],
];

const AMBIENT = [
  'Gulls cry over the water.',
  'The surf rolls in and out.',
  'A warm wind carries the smell of salt and flowers.',
  'Somewhere far off, a castle bell rings.',
  'The maroon isles shimmer on the horizon.',
];

const TOGETHER_HINT = "(Two-person jobs: one of you types the 'together ...' " +
                      'command, then the other types the same thing to help.)';

// leading pleasantries to strip: "please take the coin" -> "take the coin"
const FILLERS = ['please ', 'can you ', 'could you ', 'would you ', "let's ",
                 'lets ', 'i want to ', 'i wanna ', "i'd like to ", 'try to ',
                 'go ahead and ', 'now ', 'then ', 'just '];

// natural phrasings rewritten onto core verbs
const PHRASES = [
  ['pick up', 'take'], ['look at', 'examine'], ['look in', 'examine'],
  ['look into', 'examine'], ['look around', 'look'], ['look here', 'look'],
  ['walk to', 'go'], ['go to', 'go'], ['head to', 'go'], ['run to', 'go'],
  ['go into', 'go'], ['walk into', 'go'], ['go back', 'go back'],
  ['travel to', 'travel'], ['sail to', 'travel'], ['cross to', 'travel'],
  ['speak with', 'talk'], ['speak to', 'talk'], ['talk with', 'talk'],
  ['chat with', 'talk'], ['say hello to', 'talk'], ['say hi to', 'talk'],
  ['climb up', 'go up'], ['climb down', 'go down'],
  ['climb the stairs', 'go up'], ['climb stairs', 'go up'],
  ['where am i', 'look'], ['where are we', 'look'],
  ['what do i have', 'inventory'], ['what am i carrying', 'inventory'],
  ['what do we have', 'inventory'], ['what are we carrying', 'inventory'],
  ['who is here', 'who'], ["who's here", 'who'], ['whos here', 'who'],
  ['what should i do', 'hint'], ['what should we do', 'hint'],
  ['what now', 'hint'], ['what next', 'hint'], ['what do i do', 'hint'],
  ['knock on', 'knock'], ['knock at', 'knock'],
  ['light the torch', 'light torch'], ['set fire to', 'light'],
  ['put on', 'wear'], ['hand the', 'give the'], ['hand my', 'give my'],
];

const EMOTES = {
  bow: 'bows with a courtly flourish',
  wave: 'waves',
  nod: 'nods',
  cheer: 'cheers',
  laugh: 'laughs',
  cry: 'sniffles dramatically',
  clap: 'applauds',
  jump: 'jumps on the spot',
  whistle: 'whistles an old Daventry tune',
  shrug: 'shrugs',
  stretch: 'stretches',
  yawn: 'yawns',
};

// who's around, for the "who" command
const NPCS_IN_ROOM = {
  beach: 'no one — just the wreck and the gulls',
  village: 'the SHOPKEEPER at the pawn shop',
  gate: 'Captain SALADIN, his dog-faced guards, and CASSIMA at her tower ' +
        'window (ALHAZRED lurks nearby)',
  wonder: 'the five GNOME sentries',
  cliffs: 'no one — just the carved gates and the sealed door',
  summit: 'the ORACLE and the winged folk',
  catacombs: "nothing you'd want to meet in the dark",
  cellar: 'no one — the wedding crowd is upstairs',
  throne: 'ALHAZRED, the veiled bride, Captain SALADIN, and the whole court',
};

// listen / smell / touch / taste flavor per room
const SENSES = {
  beach: { listen: 'Surf, gulls, and the creak of the broken hull.',
           smell: 'Salt, tar, and wet rope.' },
  village: { listen: 'Market chatter, and somewhere a hammer on tin.',
             smell: 'Fresh bread from a window. Your stomachs growl.' },
  gate: { listen: 'Wedding preparations behind the wall — hammering, and the ' +
                  'vizier snapping orders.',
          smell: 'Cut flowers being carted in for the ceremony.' },
  wonder: { listen: 'The flowers are humming in four-part harmony.',
            smell: 'Every color has its own scent here. Blue smells like rain.',
            taste: 'The air tastes faintly of peppermint.',
            touch: 'The chessboard meadow is warm, like sun-baked tile.' },
  cliffs: { listen: 'Wind, and the deep silence of old stone.',
            smell: 'Cold rock and sea spray.' },
  summit: { listen: 'Wings, somewhere above. And the still pool — utterly silent.',
            smell: 'Thin, clean air with a trace of incense.' },
  catacombs: { listen: 'Dripping water... and heavy breathing from the north.',
               smell: 'Dust, old bones, and — faintly — wet bull.' },
  cellar: { listen: "Wedding music above. It's nearly time.",
            smell: 'Wine barrels and dust.' },
  throne: { listen: 'The priest is well into the wedding rite.',
            smell: "Incense and too much of the vizier's perfume." },
};

const HELP_TEXT = `👑 COMMANDS
  look (l) ............... describe where you are
  examine <thing> (x) .... look closely at something
  go <direction> ......... move — your partner comes with you (n/s/e/w/up/down)
  travel <isle> .......... use the magic map (crown / wonder / sacred)
  take <thing> ........... pick something up
  give <thing> to <name> . hand an item to your partner (or an offering)
  trade ring ............. trade at the pawn shop (Alexander)
  buy lamp ............... buy at the pawn shop (costs the copper coin)
  answer <word> .......... answer a riddle carved at the Cliffs of Logic
  light torch ............ light a torch (needs the tinder box)
  use <thing> ............ use an item
  talk <person> .......... talk to someone
  say <message> .......... chat with your partner
  together <action> ...... start (or join) a two-person job
  inventory (i) .......... what you're carrying
  hint ................... a nudge in the right direction
  newgame ................ wipe the slate and start the quest over
  help ................... this list

Natural phrasings work too: 'pick up the coin', 'look at the wreck',
'knock on the door', 'rub the lamp', 'go back', 'dig', 'listen', 'smell',
'sing', 'who is here', 'exits', 'what should we do', 'kiss cassima'...
Experiment — the world answers.
` + TOGETHER_HINT;

/* Python's str.split() with no argument splits on runs of whitespace and drops
   empties; JS split(' ') does neither. */
const words_ = (s) => s.split(/\s+/).filter((w) => w.length > 0);

/* list.remove(x) -- first occurrence only, like Python. */
function removeItem(arr, item) {
  const i = arr.indexOf(item);
  if (i !== -1) arr.splice(i, 1);
}

/* startVersion lets a reset continue the version counter instead of restarting
   it at 0. Clients long-poll with `since=<last version>`, so a counter that went
   backwards would leave every connected client waiting forever for a version it
   had already passed. */
export function createGame(startVersion = 0) {
  const state = {
    version: startVersion,
    resetRequested: false,
    log: [],          // {id, to, text, cls, speak?}
    tokens: {},       // role -> secret token
    location: 'beach',
    inv: { alexander: ['signet ring'], jollo: [] },
    flags: new Set(),
    pending: null,    // {action, by, ts}
    won: false,
    prev: null,
  };

  // Long-poll waiters, woken by flush().
  let waiters = [];

  /* ---- messaging ------------------------------------------------------- */

  /* EVERYTHING is broadcast to both players so the two screens stay identical
     in real time; `to` is kept only for call-site readability, and is stored as
     null exactly as the Python did. */
  function emit(text, to = null, cls = 'act', speak = null) {
    state.version += 1;
    const entry = { id: state.version, to: null, text, cls };
    if (speak) entry.speak = speak;
    state.log.push(entry);
  }

  function flush() {
    const w = waiters;
    waiters = [];
    for (const resolve of w) resolve();
  }

  function onChange() {
    return new Promise((resolve) => waiters.push(resolve));
  }

  const name = (role) => ROLES[role].name;
  const other = (role) => (role === 'alexander' ? 'jollo' : 'alexander');

  function partyHas(item) {
    return state.inv.alexander.includes(item) || state.inv.jollo.includes(item);
  }

  /* ---- room descriptions ----------------------------------------------- */

  function describeRoom() {
    const f = state.flags;
    const loc = state.location;
    if (loc === 'beach') {
      const lines = ['🌊 SHIPWRECK BEACH, Isle of the Crown. The remains of ' +
                     'your ship lie broken on the rocks.'];
      if (!f.has('coin_taken')) lines.push('Something glints in the wet sand — a COIN.');
      if (!f.has('tinder_taken')) {
        lines.push("Through a narrow gap in the wreck's hull you can see a " +
                   'metal TINDER BOX, just out of reach.');
      }
      lines.push('The village lies EAST along the shore.');
      return lines.join('\n');
    }
    if (loc === 'village') {
      const lines = ['🏘️ THE VILLAGE OF THE CROWN. Whitewashed houses, a quiet ' +
                     'market square, and a PAWN SHOP with a cluttered window.'];
      if (!f.has('map_traded')) {
        lines.push('In the pawn shop window: a MAGIC MAP of the Maroon Isles. ' +
                   'The SHOPKEEPER eyes your belongings.');
      }
      if (!f.has('lamp_bought')) {
        lines.push('Also in the window: an old brass LAMP, going cheap.');
      }
      lines.push("The ferry hasn't sailed since the old king and queen died. " +
                 'The beach is WEST; the castle gate is NORTH.');
      return lines.join('\n');
    }
    if (loc === 'gate') {
      const lines = ['🏰 THE CASTLE GATE. Two dog-faced guards in armor stand ' +
                     'watch. Their captain, SALADIN, bars the way.',
                     'High above, a slim figure watches from a tower window — ' +
                     'PRINCESS CASSIMA.'];
      if (!state.won) {
        lines.push('Banners are going up: the wedding of Vizier ALHAZRED and ' +
                   'Princess Cassima is at dawn.');
      }
      lines.push('The village is SOUTH.');
      return lines.join('\n');
    }
    if (loc === 'wonder') {
      const lines = ['🌷 THE ISLE OF WONDER. Impossible flowers, a chessboard ' +
                     'meadow, and an oyster snoring in a tide pool.'];
      if (!f.has('gnomes_fooled')) {
        lines.push('FIVE GNOME SENTRIES block the garden path — Sight, Sound, ' +
                   'Smell, Taste, and Touch. They demand a wonder they have ' +
                   'never sensed before.');
      } else if (!f.has('mint_taken')) {
        lines.push('Beyond the gnomes, a bed of silver MINT grows — the ' +
                   'sacred herb of the Oracle.');
      }
      return lines.join('\n');
    }
    if (loc === 'cliffs') {
      const lines = ['⛰️ THE CLIFFS OF LOGIC, Isle of the Sacred Mountain. ' +
                     'Stone stairs climb the cliff face, blocked by two ' +
                     'carved gates — one facing each of you.'];
      if (!f.has('riddle_alexander')) {
        lines.push("ALEXANDER'S CARVING reads: 'I speak without a mouth and " +
                   'hear without ears. I come alive with the wind. What am ' +
                   "I?' (answer <word>)");
      }
      if (!f.has('riddle_jollo')) {
        lines.push("JOLLO'S CARVING reads: 'The more of me you take, the more " +
                   "you leave behind. What am I?' (answer <word>)");
      }
      if (f.has('riddle_alexander') && f.has('riddle_jollo')) {
        lines.push('Both gates stand open. The stairs lead UP to the summit.');
      }
      if (f.has('catacombs_open')) {
        lines.push("At the cliff's base, the stone door of the CATACOMBS " +
                   'stands open to the NORTH.');
      } else {
        lines.push("At the cliff's base is a sealed stone door carved with a " +
                   "bull's head.");
      }
      return lines.join('\n');
    }
    if (loc === 'summit') {
      return '🕊️ THE SACRED MOUNTAIN SUMMIT. Winged folk watch from marble ' +
             'arches. In a round temple sits the ORACLE, an ageless woman ' +
             'beside a still pool.\nThe stairs lead DOWN.';
    }
    if (loc === 'catacombs') {
      const lines = [];
      if (!f.has('torch_lit')) {
        lines.push('🕯️ THE CATACOMBS. Darkness swallows everything a few steps ' +
                   'past the door. An unlit TORCH is bracketed to the wall. ' +
                   '(light torch)');
      } else {
        lines.push('🕯️ THE CATACOMBS. Torchlight shows bones, dust, and old ' +
                   'tiled passages.');
        if (!f.has('cape_taken')) lines.push('In a niche hangs a faded RED CAPE.');
        if (!f.has('minotaur_defeated')) {
          lines.push('From the passage NORTH comes heavy breathing and the ' +
                     'scrape of hooves: the MINOTAUR. Beside the passage ' +
                     'yawns a great FIRE PIT.');
        } else {
          lines.push('The passage NORTH is clear. It runs under the sea ' +
                     'toward the castle.');
        }
      }
      lines.push('The door back to the cliffs is SOUTH.');
      return lines.join('\n');
    }
    if (loc === 'cellar') {
      return '🛢️ THE CASTLE CELLARS. Barrels and dust. From above comes ' +
             'wedding music and the murmur of a gathered court.\nStairs lead ' +
             'UP to the throne room; the catacombs are DOWN.';
    }
    if (loc === 'throne') {
      if (state.won) {
        return '👑 THE THRONE ROOM. The court is cheering. Alhazred is in ' +
               'chains, and Cassima stands free beside Alexander.';
      }
      const lines = ['👑 THE THRONE ROOM. The wedding is under way. VIZIER ' +
                     'ALHAZRED stands at the dais beside a veiled bride. On a ' +
                     "cushion by his hand rests an ornate GENIE'S LAMP.",
                     'Captain SALADIN and his guards line the walls. No one ' +
                     'has noticed you at the back of the hall — yet.'];
      if (f.has('lamp_swapped')) {
        lines.push("Jollo now carries the real genie's lamp. Time to end " +
                   'this: USE LAMP.');
      }
      return lines.join('\n');
    }
    return 'You are... somewhere.';
  }

  /* ---- sidebar snapshot ------------------------------------------------ */

  function sidebar() {
    const f = state.flags;
    const checklist = [
      ['Magic map', partyHas('magic map')],
      ["Old brass lamp", partyHas('old lamp') || f.has('lamp_swapped')],
      ["Oracle's guidance", f.has('oracle_told')],
      ['Minotaur defeated', f.has('minotaur_defeated')],
      ["Genie's lamp seized", f.has('lamp_swapped')],
      ['Cassima rescued', state.won],
    ];
    const joined = {};
    const inv = {};
    for (const r of Object.keys(ROLES)) {
      joined[r] = Object.prototype.hasOwnProperty.call(state.tokens, r);
      inv[r] = [...state.inv[r]];
    }
    return {
      location: ROOMS[state.location].name,
      loc: state.location,
      joined,
      inv,
      checklist,
      won: state.won,
    };
  }

  /* ---- command handling ------------------------------------------------ */

  function handle(role, raw) {
    let text = raw.trim().toLowerCase();
    text = text.replace(/[.!?]+$/, '').trim();
    if (!text) return;

    // strip leading pleasantries: "please take the coin" -> "take ..."
    let changed = true;
    while (changed) {
      changed = false;
      for (const fl of FILLERS) {
        if (text.startsWith(fl)) {
          text = text.slice(fl.length);
          changed = true;
        }
      }
    }
    // natural phrasings -> core verbs
    for (const [phrase, repl] of PHRASES) {
      if (text === phrase || text.startsWith(phrase + ' ')) {
        text = repl + text.slice(phrase.length);
        break;
      }
    }
    const words = words_(text);
    if (words.length === 0) return;
    const verb = words[0];
    const rest = words.slice(1).join(' ');
    const me = name(role);

    if (['say', 'shout', 'whisper', 'tell'].includes(verb)) {
      // take the message from the raw input so case is preserved
      const m = new RegExp(verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(raw);
      let msg = m ? raw.slice(m.index + m[0].length).trim() : rest;
      if (verb === 'tell') msg = msg.replace(/^(jollo|alexander)\s*,?\s*/i, '');
      if (msg) {
        emit(`💬 ${me}: ${msg}`, null, 'chat', [{ who: role, text: msg }]);
      } else {
        emit('Say what?', role, 'sys');
      }
      return;
    }

    /* Not in the Python original, and deliberately so. The original told you
       to "restart the server for a fresh game"; there is no server to restart
       here, so without this the first win would end the game permanently. The
       Durable Object is replaced by room.js when this flag is set. */
    if (['newgame', 'restart'].includes(verb) ||
        (verb === 'new' && rest === 'game')) {
      state.resetRequested = true;
      emit('🔄 A fresh quest begins. Both of you are back on Shipwreck Beach ' +
           "— pick your character again if you're asked.", null, 'sys');
      return;
    }

    if (['help', '?'].includes(verb)) { emit(HELP_TEXT, role, 'sys'); return; }
    if (verb === 'hint') { emit('💡 ' + nextHint(), role, 'sys'); return; }
    if (['look', 'l'].includes(verb)) { emit(describeRoom(), role, 'room'); return; }

    if (['inventory', 'inv', 'i'].includes(verb)) {
      const mine = state.inv[role];
      const theirs = state.inv[other(role)];
      emit(`You carry: ${mine.length ? mine.join(', ') : 'nothing'}.\n` +
           `${name(other(role))} carries: ` +
           `${theirs.length ? theirs.join(', ') : 'nothing'}.`, role, 'sys');
      return;
    }

    if (['examine', 'x', 'inspect', 'read'].includes(verb)) { doExamine(role, rest); return; }

    if (['go', 'walk', 'move', 'head', 'climb'].includes(verb) ||
        Object.prototype.hasOwnProperty.call(DIR_WORDS, words[0])) {
      const dest = ['go', 'walk', 'move', 'head', 'climb'].includes(verb) ? rest : words[0];
      doGo(role, dest);
      return;
    }

    if (['travel', 'sail'].includes(verb)) { doTravel(role, rest); return; }

    if (['take', 'get', 'grab', 'pick'].includes(verb)) {
      doTake(role, (rest.startsWith('up ') ? rest.slice(3) : rest).trim());
      return;
    }

    if (verb === 'give') { doGive(role, rest); return; }
    if (verb === 'trade') { doTrade(role); return; }
    if (verb === 'buy') { doBuy(role, rest); return; }
    if (verb === 'answer') { doAnswer(role, rest); return; }
    if (verb === 'light') { doLight(role); return; }

    if (['search', 'rummage', 'open'].includes(verb)) {
      emit('Nothing here needs searching — what you need is in plain sight. ' +
           "Try 'look'.", role, 'sys');
      return;
    }

    if (verb === 'use') { doUse(role, rest); return; }

    if (['talk', 'speak', 'ask'].includes(verb)) {
      doTalk(role, (rest.startsWith('to ') ? rest.slice(3) : rest).trim());
      return;
    }

    if (verb === 'together') { doTogether(role, rest); return; }

    /* ---- natural interaction verbs ---- */

    if (['examine', 'check', 'study', 'view'].includes(verb)) { doExamine(role, rest); return; }

    if (verb === 'rub' || (['summon', 'call'].includes(verb) && rest.includes('genie'))) {
      if (rest.includes('lamp') || !rest) doUse(role, 'lamp');
      else emit(`Rubbing the ${rest} accomplishes nothing.`, role, 'sys');
      return;
    }

    if (['attack', 'fight', 'hit', 'kill', 'strike', 'slay', 'stab', 'punch'].includes(verb)) {
      doAttack(role, rest);
      return;
    }

    if (verb === 'knock') { doKnock(role); return; }
    if (['unlock', 'force'].includes(verb)) { doOpen(role, rest); return; }

    if (['listen', 'smell', 'sniff', 'taste', 'touch', 'feel'].includes(verb)) {
      const v = { sniff: 'smell', feel: 'touch' }[verb] || verb;
      doSense(role, v);
      return;
    }

    if (['sing', 'dance', 'juggle', 'perform'].includes(verb)) { doPerformSolo(role, verb); return; }
    if (verb === 'dig') { doDig(role); return; }

    if (verb === 'swim') {
      if (state.location === 'beach') {
        emit(`${me} wades in to the knees. The tide is rough, the water cold, ` +
             "and there's a princess to save. Another day.", null, 'act');
      } else {
        emit('There\'s no water to swim in here.', role, 'sys');
      }
      return;
    }

    if (['pet', 'feed'].includes(verb)) { doPet(role, verb, rest); return; }
    if (verb === 'kiss') { doKiss(role, rest); return; }

    if (['steal', 'swap', 'switch', 'snatch'].includes(verb)) {
      if (state.location === 'throne' && !state.flags.has('lamp_swapped')) {
        emit('Too risky alone — this is a two-person con: ' +
             "'together swap lamp'.", role, 'sys');
      } else {
        emit('Nothing here needs stealing.', role, 'sys');
      }
      return;
    }

    if (['drink', 'eat'].includes(verb)) {
      if (rest.includes('mint') && partyHas('mint')) {
        emit(`${me} moves the mint toward their mouth — then remembers what ` +
             'the Oracle charges for her visions. Better not.', null, 'act');
      } else {
        emit('Now is not the time for a snack.', role, 'sys');
      }
      return;
    }

    if (verb === 'who') {
      const here = Object.prototype.hasOwnProperty.call(NPCS_IN_ROOM, state.location)
        ? NPCS_IN_ROOM[state.location] : 'no one';
      emit(`Here: ${here}. ${name(other(role))} is beside you, as always.`,
           role, 'sys');
      return;
    }

    if (verb === 'exits') {
      const exits = Object.entries(ROOMS[state.location].exits)
        .map(([d, r]) => `${d.toUpperCase()} to the ${ROOMS[r].name}`)
        .join(', ');
      const extra = (partyHas('magic map') && MAP_SPOTS.has(state.location))
        ? " The magic map can also carry you between isles ('travel <isle>')."
        : '';
      emit((exits ? `Ways out: ${exits}.`
                  : 'No walking exits — the magic map brought you here.') + extra,
           role, 'sys');
      return;
    }

    if (['wait', 'rest', 'sleep'].includes(verb)) {
      emit(`${me} pauses to catch their breath. Somewhere, the night creeps ` +
           'on toward dawn.', null, 'ambient');
      return;
    }

    if (verb === 'pray') {
      if (state.location === 'summit') {
        emit(`${me} bows before the still pool. The winged folk bow their ` +
             'heads in answer.', null, 'act');
      } else {
        emit(`${me} offers a quiet prayer for Cassima.`, null, 'act');
      }
      return;
    }

    if (['hug', 'thank', 'highfive', 'greet'].includes(verb)) {
      const o = name(other(role));
      const acts = {
        hug: `${me} gives ${o} a quick, fierce hug.`,
        thank: `${me} claps ${o} on the shoulder. 'Couldn't do this without you.'`,
        highfive: `${me} and ${o} exchange a high five.`,
        greet: `${me} waves to ${o}.`,
      };
      emit(acts[verb], null, 'act');
      return;
    }

    if (['wear', 'wave'].includes(verb) && rest.includes('cape')) {
      emit("Save the cape work for the Minotaur: 'together fight minotaur'.",
           role, 'sys');
      return;
    }

    if (Object.prototype.hasOwnProperty.call(EMOTES, verb)) {
      emit(`${me} ${EMOTES[verb]}.`, null, 'act');
      return;
    }

    if (verb === 'enter') {
      if (rest.includes('shop') && state.location === 'village') {
        emit('You step into the cluttered pawn shop. Maps, lamps, and a ' +
             "hundred stranger things. ('trade ring', 'buy lamp', or 'talk " +
             "shopkeeper')", null, 'act');
      } else {
        doGo(role, rest);
      }
      return;
    }

    if (['status', 'quest', 'goal', 'objective', 'checklist'].includes(verb)) {
      const cl = sidebar().checklist;
      const done = cl.filter(([, ok]) => ok).map(([lbl]) => lbl);
      const todo = cl.filter(([, ok]) => !ok).map(([lbl]) => lbl);
      emit('Done: ' + (done.length ? done.join(', ') : 'nothing yet') +
           '.\nStill to do: ' +
           (todo.length ? todo.join(', ') : 'nothing — you won!') + '.',
           role, 'sys');
      return;
    }

    if (verb === 'throw') {
      emit(`${me} hefts it, reconsiders, and puts it away. Throwing things ` +
           'rarely solves royal problems.', null, 'act');
      return;
    }

    emit(`You don't know how to '${verb}'. Try 'help' — or 'say ${text}' if ` +
         'you were talking to your partner.', role, 'sys');
  }

  /* ---- movement -------------------------------------------------------- */

  function doGo(role, dest) {
    // drop articles: "go to the village" -> "village"
    dest = words_(dest.trim())
      .filter((w) => !['the', 'a', 'an', 'to', 'into'].includes(w))
      .join(' ');
    if (!dest) { emit('Go where?', role, 'sys'); return; }
    const room = ROOMS[state.location];
    let target = null;
    if (['back', 'return'].includes(dest) && state.prev) {
      // only if it's still adjacent
      if (Object.values(room.exits).includes(state.prev)) target = state.prev;
    }
    const d = DIR_WORDS[dest];
    if (!target && d && Object.prototype.hasOwnProperty.call(room.exits, d)) {
      target = room.exits[d];
    }
    if (!target) {
      for (const rid of Object.values(room.exits)) {
        if (rid.includes(dest) || dest.includes(rid) ||
            ROOMS[rid].name.toLowerCase().includes(dest)) {
          target = rid;
          break;
        }
      }
    }
    if (!target) {
      // walking toward another isle? point at the map
      for (const [key] of MAP_DESTS) {
        if (dest.includes(key)) { doTravel(role, dest); return; }
      }
      emit("You can't go that way. ('exits' lists the ways out.)", role, 'sys');
      return;
    }
    // gates
    const f = state.flags;
    if (target === 'summit' && !(f.has('riddle_alexander') && f.has('riddle_jollo'))) {
      emit('The carved gates block the stairs until BOTH riddles are answered.',
           role, 'sys');
      return;
    }
    if (target === 'catacombs' && state.location === 'cliffs' && !f.has('catacombs_open')) {
      emit('The stone door is sealed. Perhaps the Oracle on the summit knows ' +
           'how to open it.', role, 'sys');
      return;
    }
    if (target === 'cellar' && state.location === 'catacombs' && !f.has('minotaur_defeated')) {
      emit("The Minotaur blocks the north passage. You'll have to deal with " +
           'it first.', role, 'sys');
      return;
    }
    state.prev = state.location;
    state.location = target;
    state.pending = null;
    emit(`— ${name(role)} leads the way to the ${ROOMS[target].name} —`, null, 'move');
    emit(describeRoom(), null, 'room');
    firstVisitScene(target);
    if (MAP_SPOTS.has(target) && Math.random() < 0.25) {
      emit(AMBIENT[Math.floor(Math.random() * AMBIENT.length)], null, 'ambient');
    }
  }

  function firstVisitScene(target) {
    const f = state.flags;
    if (target === 'gate' && !f.has('gate_scene')) {
      f.add('gate_scene');
      const viz = 'Well, well. Castaways. The castle is closed until after my ' +
                  'wedding to the princess. Begone — or the guards will see ' +
                  'you off.';
      const cas = 'Beware the vizier! He holds the whole castle in his power!';
      emit(`🐍 VIZIER ALHAZRED appears at the gate, smiling thinly: '${viz}'`,
           null, 'npc', [{ who: 'alhazred', text: viz }]);
      emit(`From the tower window, Cassima calls down softly: '${cas}'`,
           null, 'npc', [{ who: 'cassima', text: cas }]);
      emit("Jollo whispers: 'The vizier keeps a genie in an ornate lamp — " +
           "that's how he rules. If we could swap it for a fake, his power is " +
           "finished.'", null, 'npc');
      return;
    }
    if (target === 'throne' && !f.has('throne_scene')) {
      f.add('throne_scene');
      emit("The priest drones through the wedding rite. Alhazred's hand rests " +
           "inches from the genie's lamp. If you're going to swap it for the " +
           "old lamp, it must be now: 'together swap lamp'.", null, 'npc');
    }
  }

  function doTravel(role, dest) {
    if (!partyHas('magic map')) {
      emit("You have no way to cross the sea. The pawn shop's magic map would " +
           'do it.', role, 'sys');
      return;
    }
    if (!MAP_SPOTS.has(state.location)) {
      emit("The map's magic can't reach you here — get back to open sky first.",
           role, 'sys');
      return;
    }
    dest = dest.trim();
    if (dest.includes('beast') || dest.includes('mist')) {
      emit('The map shows the Isle of the Beast wrapped in dark mist. The ' +
           'magic refuses to take you there.', role, 'sys');
      return;
    }
    for (const [key, [room, label]] of MAP_DESTS) {
      if (dest.includes(key)) {
        if (room === state.location) { emit("You're already there.", role, 'sys'); return; }
        state.location = room;
        state.pending = null;
        emit(`🗺️ ${name(role)} touches the ${label} on the magic map. The ` +
             'world folds like paper — and you are both there.', null, 'move');
        emit(describeRoom(), null, 'room');
        firstVisitScene(room);
        return;
      }
    }
    emit('The map shows: CROWN, WONDER, and SACRED (mountain). ' +
         "Try 'travel <isle>'.", role, 'sys');
  }

  /* ---- items ----------------------------------------------------------- */

  function doTake(role, noun) {
    if (!noun) { emit('Take what?', role, 'sys'); return; }
    const loc = state.location;
    const f = state.flags;
    const me = name(role);

    if (noun.includes('coin') && loc === 'beach') {
      if (f.has('coin_taken')) {
        emit("The coin's already been picked up.", role, 'sys');
      } else {
        f.add('coin_taken');
        state.inv[role].push('copper coin');
        emit(`🪙 ${me} pulls a COPPER COIN from the wet sand.`, null, 'good');
      }
      return;
    }

    if (noun.includes('tinder') && loc === 'beach') {
      if (f.has('tinder_taken')) {
        emit('The tinder box is already in hand.', role, 'sys');
      } else if (role === 'jollo') {
        f.add('tinder_taken');
        state.inv.jollo.push('tinder box');
        emit('🔥 Jollo wriggles through the gap in the hull and comes out ' +
             'with the TINDER BOX.', null, 'good');
      } else {
        emit("Alexander's shoulders won't fit through the gap. Jollo could " +
             'manage it.', null, 'act');
      }
      return;
    }

    if (noun.includes('mint') && loc === 'wonder') {
      if (f.has('mint_taken')) {
        emit('You already have the mint.', role, 'sys');
      } else if (!f.has('gnomes_fooled')) {
        emit("The gnome sentries block the garden. They want a wonder they've " +
             'never sensed before.', role, 'sys');
      } else {
        f.add('mint_taken');
        state.inv[role].push('mint');
        emit(`🌿 ${me} picks a sprig of silver MINT. It smells like cold ` +
             'starlight.', null, 'good');
      }
      return;
    }

    if (noun.includes('cape') && loc === 'catacombs') {
      if (!f.has('torch_lit')) {
        emit("It's too dark to see anything but the doorway. Light the torch " +
             'first.', role, 'sys');
      } else if (f.has('cape_taken')) {
        emit("The cape's already been taken.", role, 'sys');
      } else {
        f.add('cape_taken');
        state.inv[role].push('red cape');
        emit(`🟥 ${me} takes the faded RED CAPE from its niche.`, null, 'good');
      }
      return;
    }

    if (noun.includes('torch') && loc === 'catacombs') {
      emit("The torch is bracketed to the wall. 'light torch' is what you want.",
           role, 'sys');
      return;
    }

    if ((noun.includes('map') || noun.includes('lamp')) && loc === 'village') {
      emit('The shopkeeper clears his throat. Things in this shop are traded ' +
           "or bought, not taken. ('trade ring', 'buy lamp')", role, 'sys');
      return;
    }

    emit(`You can't take '${noun}' here.`, role, 'sys');
  }

  function doTrade(role) {
    const f = state.flags;
    if (state.location !== 'village') { emit('The pawn shop is in the village.', role, 'sys'); return; }
    if (f.has('map_traded')) { emit('The map is already yours.', role, 'sys'); return; }
    if (role !== 'alexander') {
      emit('The shopkeeper wants something of real value — like the signet ' +
           'ring Alexander wears.', role, 'sys');
      return;
    }
    if (!state.inv.alexander.includes('signet ring')) {
      emit('You no longer have the ring.', role, 'sys');
      return;
    }
    removeItem(state.inv.alexander, 'signet ring');
    state.inv.alexander.push('magic map');
    f.add('map_traded');
    const line = 'A royal signet ring! Done, done. The map is yours — touch ' +
                 'any isle drawn on it and it will carry you there.';
    emit('Alexander looks at his family crest one last time and sets the ring ' +
         `on the counter.\n🗺️ SHOPKEEPER: '${line}'`, null, 'good',
         [{ who: 'shopkeeper', text: line }]);
  }

  function doBuy(role, noun) {
    const f = state.flags;
    if (state.location !== 'village') { emit('The pawn shop is in the village.', role, 'sys'); return; }
    if (noun && !noun.includes('lamp')) {
      emit('The only thing worth buying here is the old brass lamp.', role, 'sys');
      return;
    }
    if (f.has('lamp_bought')) { emit('You already bought the lamp.', role, 'sys'); return; }
    if (!state.inv[role].includes('copper coin')) {
      if (partyHas('copper coin')) {
        emit('Your partner holds the coin — they should buy it, or hand the ' +
             'coin over.', role, 'sys');
      } else {
        emit('You have no money. There was a coin in the sand on the beach.',
             role, 'sys');
      }
      return;
    }
    removeItem(state.inv[role], 'copper coin');
    state.inv[role].push('old lamp');
    f.add('lamp_bought');
    emit(`🪔 ${name(role)} buys the OLD BRASS LAMP for one copper coin. ` +
         'Dented, dusty — and at a glance, not so different from a certain ' +
         "vizier's lamp.", null, 'good');
  }

  function doGive(role, rest) {
    const parts = rest.split(' to ');
    if (parts.length !== 2) { emit('Try: give <item> to <name>.', role, 'sys'); return; }
    const itemWords = parts[0].trim();
    const target = parts[1].trim();

    // offering to the Oracle
    if (target.includes('oracle')) { doOfferOracle(role, itemWords); return; }

    const o = other(role);
    if (!target.includes(name(o).toLowerCase()) && !target.includes(o)) {
      emit('You can give things to your partner, or make an offering to the ' +
           'Oracle.', role, 'sys');
      return;
    }
    for (const item of [...state.inv[role]]) {
      if (itemWords.includes(item) || item.includes(itemWords)) {
        removeItem(state.inv[role], item);
        state.inv[o].push(item);
        emit(`${name(role)} hands the ${item} to ${name(o)}.`, null, 'act');
        return;
      }
    }
    emit(`You aren't carrying '${itemWords}'.`, role, 'sys');
  }

  function doOfferOracle(role, itemWords) {
    const f = state.flags;
    if (state.location !== 'summit') {
      emit('The Oracle is on the Sacred Mountain summit.', role, 'sys');
      return;
    }
    if (!itemWords.includes('mint')) {
      emit('The Oracle accepts only the sacred mint of the Isle of Wonder.',
           role, 'sys');
      return;
    }
    if (!state.inv[role].includes('mint')) {
      emit("You aren't carrying the mint.", role, 'sys');
      return;
    }
    if (f.has('oracle_told')) { emit('The Oracle has already spoken.', role, 'sys'); return; }
    removeItem(state.inv[role], 'mint');
    f.add('oracle_told');
    f.add('catacombs_open');
    const line = 'Hear the truth. The vizier Alhazred murdered the king and ' +
                 'queen, and rules through a genie bound to an ornate lamp. ' +
                 'At dawn he weds Cassima and the Maroon Isles are his. But ' +
                 'the old catacombs run beneath the sea from this island to ' +
                 'the castle cellars. I have opened their door. Beware the ' +
                 'Minotaur that haunts them — no blade can stop his charge, ' +
                 'but a matador\'s trick may. Go. Swap the lamp, and his ' +
                 'power ends.';
    emit("The Oracle breathes the mint's scent and her eyes turn white.\n" +
         `🔮 ORACLE: '${line}'`, null, 'npc', [{ who: 'oracle', text: line }]);
    emit('Far below, you hear stone grinding — the catacombs door at the ' +
         "cliff's base is open.", null, 'good');
  }

  function doAnswer(role, word) {
    const f = state.flags;
    if (state.location !== 'cliffs') {
      emit("There's no riddle to answer here.", role, 'sys');
      return;
    }
    word = word.trim().toLowerCase();
    if (!word) { emit("Answer what? Read your carving ('look').", role, 'sys'); return; }
    if (role === 'alexander') {
      if (f.has('riddle_alexander')) {
        emit('Your gate is already open.', role, 'sys');
      } else if (word.includes('echo')) {
        f.add('riddle_alexander');
        emit("⛰️ 'ECHO,' says Alexander — and the word rolls back from the " +
             'cliffs three times. His gate grinds open.', null, 'good');
      } else {
        emit('The carving is silent. Wrong answer — think about it and try ' +
             'again.', role, 'sys');
      }
    } else {
      if (f.has('riddle_jollo')) {
        emit('Your gate is already open.', role, 'sys');
      } else if (word.includes('footstep') || word.includes('step') || word.includes('footprint')) {
        f.add('riddle_jollo');
        emit("⛰️ 'FOOTSTEPS,' says Jollo — and his gate grinds open.", null, 'good');
      } else {
        emit('The carving is silent. Wrong answer — think about it and try ' +
             'again.', role, 'sys');
      }
    }
    if (f.has('riddle_alexander') && f.has('riddle_jollo') && !f.has('cliffs_done')) {
      f.add('cliffs_done');
      emit('Both gates stand open. The stairs to the summit are clear — go UP.',
           null, 'good');
    }
  }

  function doLight(role) {
    const f = state.flags;
    if (state.location !== 'catacombs') {
      emit("There's nothing here that needs lighting.", role, 'sys');
      return;
    }
    if (f.has('torch_lit')) { emit('The torch is already burning.', role, 'sys'); return; }
    if (!state.inv[role].includes('tinder box')) {
      if (partyHas('tinder box')) {
        emit('Your partner has the tinder box.', role, 'sys');
      } else {
        emit('You have nothing to make fire with. There was a tinder box in ' +
             'the shipwreck.', role, 'sys');
      }
      return;
    }
    f.add('torch_lit');
    emit(`🔥 ${name(role)} strikes the tinder box and the wall torch catches. ` +
         'Light spills down the passage — and something big, somewhere north, ' +
         'snorts.', null, 'good');
  }

  function doUse(role, rest) {
    const loc = state.location;
    const f = state.flags;
    const a = rest.split(' on ')[0].trim();

    if (a.includes('map')) {
      if (!partyHas('magic map')) {
        emit("You don't have the map yet.", role, 'sys');
      } else {
        emit('The magic map shows three isles you can reach: CROWN, WONDER, ' +
             "and SACRED. ('travel <isle>')", role, 'sys');
      }
      return;
    }

    if (a.includes('tinder')) { doLight(role); return; }

    if (a.includes('cape')) {
      emit("The cape is for the Minotaur — a two-person bullfight: 'together " +
           "fight minotaur'.", role, 'sys');
      return;
    }

    if (a.includes('lamp')) {
      if (!f.has('lamp_swapped')) {
        if (loc === 'throne') {
          emit('Not yet — Alhazred still holds the real lamp. Swap it first: ' +
               "'together swap lamp'.", role, 'sys');
        } else {
          emit('The old lamp is just a prop. It matters at the wedding.',
               role, 'sys');
        }
        return;
      }
      if (loc !== 'throne') { emit('Save it for the throne room.', role, 'sys'); return; }
      finale(role);
      return;
    }

    emit(`You can't figure out how to use '${rest}' here.`, role, 'sys');
  }

  /* ---- npcs ------------------------------------------------------------ */

  function doTalk(role, who) {
    // "ask the shopkeeper about the map" -> "shopkeeper"
    who = who.split(' about ')[0];
    who = words_(who).filter((w) => !['the', 'a', 'an'].includes(w)).join(' ');
    const loc = state.location;
    if (loc === 'village' && (who.includes('shop') || who.includes('keeper'))) {
      const line = !state.flags.has('map_traded')
        ? 'The magic map? Not for coin, friend — for something of true worth. ' +
          'That signet ring the tall one wears would do nicely. The old lamp, ' +
          "though — that I'll sell for a copper."
        : 'Pleasure doing business. Mind how you fold that map.';
      emit(`🗺️ SHOPKEEPER: '${line}'`, null, 'npc', [{ who: 'shopkeeper', text: line }]);
      return;
    }
    if (loc === 'gate' && who.includes('saladin')) {
      const line = 'None enter before the wedding. I have my orders. ...For ' +
                   'what it is worth, strangers, I do not like these orders.';
      emit(`🛡️ CAPTAIN SALADIN: '${line}'`, null, 'npc', [{ who: 'saladin', text: line }]);
      return;
    }
    if (loc === 'gate' && (who.includes('cassima') || who.includes('princess'))) {
      const line = 'Alexander! You came! The vizier watches me always — I ' +
                   'cannot come down. His power is in the ornate lamp he ' +
                   'keeps at his side. Hurry — the wedding is at dawn!';
      emit(`👸 CASSIMA (from the tower window): '${line}'`, null, 'npc',
           [{ who: 'cassima', text: line }]);
      return;
    }
    if (loc === 'gate' && (who.includes('vizier') || who.includes('alhazred'))) {
      const line = 'Still here? The guards are excellent judges of when a ' +
                   'conversation is over.';
      emit(`🐍 ALHAZRED: '${line}'`, null, 'npc', [{ who: 'alhazred', text: line }]);
      return;
    }
    if (loc === 'wonder' && who.includes('gnome')) {
      const line = 'Halt! We are the Five Senses, and none pass but they show ' +
                   'us a wonder we have never seen, heard, smelled, tasted, ' +
                   'nor touched!';
      emit(`🍄 THE GNOME SENTRIES (in unison): '${line}'`, null, 'npc',
           [{ who: 'gnome', text: line }]);
      return;
    }
    if (loc === 'summit' && who.includes('oracle')) {
      const line = state.flags.has('oracle_told')
        ? 'I have spoken. The catacombs await.'
        : 'I see far, travelers, but my sight has a price: a sprig of the ' +
          'silver mint that grows on the Isle of Wonder.';
      emit(`🔮 ORACLE: '${line}'`, null, 'npc', [{ who: 'oracle', text: line }]);
      return;
    }
    emit(`There's no '${who}' here to talk to.`, role, 'sys');
  }

  function doExamine(role, noun) {
    if (!noun) { emit('Examine what?', role, 'sys'); return; }
    const db = [
      ['ring', "Alexander's royal signet ring, crest of Daventry. The " +
               'shopkeeper would trade the magic map for it.'],
      ['map', 'The Maroon Isles inked in gold: Crown, Wonder, Sacred Mountain, ' +
              'and — smudged in dark mist — the Beast.'],
      ['coin', 'One copper coin, sea-worn but good.'],
      ['tinder', 'Flint, steel, and charcloth in a tin. Fire on demand.'],
      ['wreck', 'Your poor ship. The gap in the hull is barely a hand-span wide.'],
      ['lamp', 'The old brass lamp: dented, empty, ordinary. But shine it up ' +
               "and it could pass for the vizier's at arm's length."],
      ['mint', "Silver-leafed mint. The Oracle's price."],
      ['cape', "A faded matador's cape. Still red enough."],
      ['minotaur', 'Horns, hooves, and a temper. It paws the ground beside ' +
                   'the open fire pit.'],
      ['pit', 'A wide fire pit, deep and hot. Anything that charges into it ' +
              "isn't charging out."],
      ['gnome', 'Five stern little sentries, each proud of one sense.'],
      ['oracle', 'Ageless, patient, and looking straight through you.'],
      ['cassima', 'Dark hair, green eyes, and a glare aimed at the vizier ' +
                  'that could cut glass.'],
      ['alhazred', 'Silk robes, a thin smile, and an ornate lamp never out of ' +
                   'his reach.'],
      ['genie', 'The ornate lamp gleams on its cushion. Whoever holds it ' +
                'commands the genie Shamir.'],
      ['saladin', 'The captain of the guard. Honorable to a fault — the fault ' +
                  'being his orders.'],
      ['carving', "Two riddle gates, one facing each of you. Answer with " +
                  "'answer <word>'."],
    ];
    for (const [key, desc] of db) {
      if (noun.includes(key)) { emit(desc, role, 'sys'); return; }
    }
    emit(`You see nothing special about '${noun}'.`, role, 'sys');
  }

  /* ---- natural interaction helpers ------------------------------------- */

  function doAttack(role, rest) {
    const loc = state.location;
    const me = name(role);
    if (rest.includes('minotaur') ||
        (loc === 'catacombs' && !state.flags.has('minotaur_defeated'))) {
      emit("Alone, against a Minotaur? That's how legends end early. Make it " +
           "a bullfight: 'together fight minotaur'.", role, 'sys');
      return;
    }
    if (['vizier', 'alhazred', 'guard'].some((w) => rest.includes(w))) {
      emit('Blades against the whole castle guard is a plan with no second ' +
           'act. Win with the lamp instead.', role, 'sys');
      return;
    }
    emit(`${me} glares menacingly at nothing in particular. Violence isn't ` +
         'the answer here.', null, 'act');
  }

  function doKnock(role) {
    const loc = state.location;
    const me = name(role);
    if (loc === 'gate') {
      const line = 'I heard you the first time. The gate stays shut until ' +
                   'after the wedding.';
      emit(`${me} raps on the great gate.\n🛡️ CAPTAIN SALADIN: '${line}'`,
           null, 'npc', [{ who: 'saladin', text: line }]);
      return;
    }
    if (loc === 'village') {
      const line = "Come in, come in! Everything's for sale — almost.";
      emit(`${me} knocks at the pawn shop door.\n🗺️ SHOPKEEPER: '${line}'`,
           null, 'npc', [{ who: 'shopkeeper', text: line }]);
      return;
    }
    if (loc === 'cliffs' && !state.flags.has('catacombs_open')) {
      emit(`${me} knocks on the sealed stone door. The bull's head carving ` +
           'stares back, unmoved. The Oracle above may know how to open it.',
           null, 'act');
      return;
    }
    emit("There's nothing here worth knocking on.", role, 'sys');
  }

  function doOpen(role, rest) {
    const loc = state.location;
    const f = state.flags;
    if (rest.includes('door') || !rest) {
      if (loc === 'cliffs' && !f.has('catacombs_open')) {
        emit("The stone door doesn't budge — it answers to the Oracle, not to " +
             'shoulders.', role, 'sys');
        return;
      }
      if (loc === 'cliffs') {
        emit('The catacombs door already stands open (NORTH).', role, 'sys');
        return;
      }
    }
    emit('Nothing here is locked — the obstacles are bigger than locks.',
         role, 'sys');
  }

  function doSense(role, sense) {
    const roomSenses = SENSES[state.location] || {};
    if (Object.prototype.hasOwnProperty.call(roomSenses, sense)) {
      emit(roomSenses[sense], role, 'sys');
    } else if (state.location === 'wonder') {
      const gn = { listen: 'Sound', smell: 'Smell', taste: 'Taste', touch: 'Touch' }[sense] || 'Sight';
      emit(`The ${gn} gnome watches you ${sense} the air and nods approvingly. ` +
           'A connoisseur.', role, 'sys');
    } else {
      emit(`You ${sense} nothing out of the ordinary.`, role, 'sys');
    }
  }

  function doPerformSolo(role, verb) {
    const me = name(role);
    if (state.location === 'wonder' && !state.flags.has('gnomes_fooled')) {
      emit(`${me} starts to ${verb} — the gnomes lean in, intrigued, but five ` +
           'senses take more than a solo act. Make it a duet: ' +
           "'together perform show'.", null, 'act');
      return;
    }
    if (verb === 'juggle' && role === 'jollo') {
      emit('Jollo juggles three pebbles, then four, then five, without ' +
           'looking. Show-off.', null, 'act');
    } else if (verb === 'juggle') {
      emit('Alexander juggles two pebbles briefly, then zero pebbles. Jollo ' +
           'pretends not to have seen.', null, 'act');
    } else if (verb === 'sing') {
      emit(`${me} sings a verse of an old Daventry ballad. Somewhere, a gull ` +
           'joins in.', null, 'act');
    } else {
      emit(`${me} breaks into a few dance steps. Morale improves measurably.`,
           null, 'act');
    }
  }

  function doDig(role) {
    const f = state.flags;
    const me = name(role);
    if (state.location === 'beach') {
      if (!f.has('coin_taken')) {
        f.add('coin_taken');
        state.inv[role].push('copper coin');
        emit(`🪙 ${me} digs through the wet sand and turns up the COPPER COIN.`,
             null, 'good');
      } else {
        emit(`${me} digs a respectable hole. It contains sand.`, null, 'act');
      }
      return;
    }
    emit("The ground here doesn't invite digging.", role, 'sys');
  }

  function doPet(role, verb, rest) {
    const loc = state.location;
    const me = name(role);
    if (loc === 'gate') {
      emit(`${me} cautiously ${verb}s one of the dog-faced guards... whose ` +
           'tail betrays a single, dignified wag before discipline reasserts ' +
           'itself.', null, 'act');
      return;
    }
    if (loc === 'wonder') {
      emit('The gnomes draw themselves up to their full height (not far). ' +
           "'We are SENTRIES, not PETS.'", null, 'act');
      return;
    }
    emit("There's nothing here that wants that.", role, 'sys');
  }

  function doKiss(role, rest) {
    const me = name(role);
    const loc = state.location;
    if (rest.includes('cassima') || rest.includes('princess') || rest.includes('bride')) {
      if (state.won) {
        emit('👑💋 The court cheers all over again. The minstrels will be ' +
             'dining out on this wedding for years.', null, 'good');
      } else if (loc === 'gate') {
        emit('From thirty feet below her tower window? Romantic. Impractical, ' +
             'but romantic.', role, 'sys');
      } else {
        emit("Cassima isn't here — and there's a vizier in the way besides.",
             role, 'sys');
      }
      return;
    }
    const o = name(other(role));
    emit(`${me} blows a theatrical kiss. ${o} pretends to catch it and throws ` +
         'it into the sea.', null, 'act');
  }

  /* ---- together actions ------------------------------------------------ */

  function normalizeTogether(action) {
    if (['perform', 'show', 'juggle', 'dance'].some((w) => action.includes(w))) return 'perform show';
    if (['minotaur', 'fight', 'bull', 'cape'].some((w) => action.includes(w))) return 'fight minotaur';
    if (['swap', 'lamp', 'switch'].some((w) => action.includes(w))) return 'swap lamp';
    return null;
  }

  function doTogether(role, action) {
    const me = name(role);
    const o = other(role);
    if (!Object.prototype.hasOwnProperty.call(state.tokens, o)) {
      emit("Your partner hasn't joined the game yet — 'together' actions need " +
           'both of you.', role, 'sys');
      return;
    }
    const act = normalizeTogether(action);
    if (!act) {
      emit("Known two-person jobs: 'together perform show', 'together fight " +
           "minotaur', 'together swap lamp'.", role, 'sys');
      return;
    }
    const p = state.pending;
    if (p && p.action === act && p.by !== role && (Date.now() / 1000) - p.ts < 120) {
      state.pending = null;
      resolveTogether(act, p.by, role);
      return;
    }
    state.pending = { action: act, by: role, ts: Date.now() / 1000 };
    const call = `${name(o)} — together, ${act}!`;
    emit(`🤝 ${me} calls out: '${call}'  (Partner: type 'together ${act}' to ` +
         'help.)', null, 'act', [{ who: role, text: call }]);
  }

  function resolveTogether(act, initiator, helper) {
    const f = state.flags;
    const loc = state.location;
    if (act === 'perform show') {
      if (loc !== 'wonder') {
        emit("There's no audience here worth performing for.", null, 'sys');
        return;
      }
      if (f.has('gnomes_fooled')) {
        emit('The gnomes have already waved you through.', null, 'sys');
        return;
      }
      f.add('gnomes_fooled');
      emit('🎭 Jollo produces three shells and juggles them in a blur while ' +
           'Alexander drums a march on his scabbard and sings a Daventry sea ' +
           'shanty — badly, but with total commitment.\n' +
           'The Sight gnome has never SEEN such juggling. The Sound gnome has ' +
           'never HEARD such singing (he is being polite). The other three ' +
           'simply applaud.\n' +
           "🍄 'A wonder indeed! Pass, travelers!' The path to the mint " +
           'garden is open.', null, 'good',
           [{ who: 'gnome', text: 'A wonder indeed! Pass, travelers!' }]);
      return;
    }
    if (act === 'fight minotaur') {
      if (loc !== 'catacombs') { emit('The Minotaur is in the catacombs.', null, 'sys'); return; }
      if (f.has('minotaur_defeated')) {
        emit('The Minotaur is already dealt with.', null, 'sys');
        return;
      }
      if (!f.has('torch_lit')) {
        emit('Fight it in the dark? Light the torch first.', null, 'sys');
        return;
      }
      if (!partyHas('red cape')) {
        emit('Charging a Minotaur bare-handed is a short story. The red cape ' +
             'in the niche would make it a bullfight.', null, 'sys');
        return;
      }
      f.add('minotaur_defeated');
      emit('🐂 Jollo steps into the open and snaps the red cape wide. The ' +
           'Minotaur bellows, drops its horns, and CHARGES.\n' +
           'At the last instant Jollo whirls the cape aside — and Alexander, ' +
           "braced beside the fire pit, throws his whole weight into the " +
           "beast's flank.\n" +
           'The Minotaur plunges past the edge and down into the flames. The ' +
           'catacombs go quiet. The passage NORTH is clear.', null, 'good');
      return;
    }
    if (act === 'swap lamp') {
      if (loc !== 'throne') { emit("The genie's lamp is in the throne room.", null, 'sys'); return; }
      if (f.has('lamp_swapped')) {
        emit('The lamps are already swapped — USE LAMP.', null, 'sys');
        return;
      }
      if (!partyHas('old lamp')) {
        emit('You need a convincing fake to leave in its place. The pawn shop ' +
             'sold an old brass lamp.', null, 'sys');
        return;
      }
      f.add('lamp_swapped');
      for (const r of ['alexander', 'jollo']) {
        if (state.inv[r].includes('old lamp')) removeItem(state.inv[r], 'old lamp');
      }
      state.inv.jollo.push("genie's lamp");
      const objection = 'STOP THE WEDDING! I am Alexander of Daventry!';
      emit(`👑 Alexander strides up the center aisle: '${objection}'\n` +
           'Every head turns. Alhazred rises, furious — and in that moment ' +
           'Jollo the clown tumbles past the dais, juggling, bowing, and with ' +
           'one practiced sleight of hand leaves the OLD LAMP on the cushion ' +
           "and palms the GENIE'S LAMP.\n" +
           'Jollo has the real lamp. Now: USE LAMP.', null, 'good',
           [{ who: 'alexander', text: objection }]);
      return;
    }
  }

  /* ---- finale ---------------------------------------------------------- */

  function finale(role) {
    state.won = true;
    const alh = 'Shamir! Destroy these intruders!';
    const sha = 'I obey the holder of the lamp... and that, vizier, is no ' +
                'longer you.';
    const cas = 'Alexander of Daventry — you kept your promise.';
    const sal = 'Seize the vizier. In the name of the true crown of the Maroon ' +
                'Isles — seize him!';
    emit(`🪔 ${name(role)} holds the ornate lamp high and rubs it.\n` +
         'Smoke pours out and towers to the ceiling: the genie SHAMIR.\n\n' +
         `🐍 ALHAZRED: '${alh}'\n` +
         `💨 SHAMIR (bowing to the lamp in Jollo's hands): '${sha}'\n\n` +
         'The color drains from the vizier\'s face. He lunges for the cushion ' +
         '— and comes up holding a dented old brass lamp.\n\n' +
         `🛡️ CAPTAIN SALADIN: '${sal}'\n\n` +
         'The guards close in. The bride throws back her veil — Cassima, ' +
         'eyes blazing, already pulling free of the dais.\n\n' +
         `👸 CASSIMA: '${cas}'\n\n` +
         'That morning the Maroon Isles see a wedding after all — the right ' +
         'one. Shamir, freed of his master, showers the isles with flowers.\n\n' +
         '🏆 ═══ YOU WIN — HEIR TODAY, GONE TOMORROW ═══ 🏆\n' +
         "The Maroon Isles are saved. Type 'newgame' to play again!",
         null, 'win',
         [{ who: 'alhazred', text: alh }, { who: 'shamir', text: sha },
          { who: 'saladin', text: sal }, { who: 'cassima', text: cas }]);
  }

  /* ---- hints ----------------------------------------------------------- */

  function nextHint() {
    const f = state.flags;
    if (!f.has('coin_taken')) return "There's a coin in the sand on the beach — take it.";
    if (!f.has('tinder_taken')) {
      return 'A tinder box sits inside the wreck, through a gap only Jollo ' +
             "can fit ('take tinder box').";
    }
    if (!f.has('map_traded')) {
      return "The pawn shop in the village trades the magic map for " +
             "Alexander's signet ring ('trade ring').";
    }
    if (!f.has('lamp_bought')) {
      return "Buy the old brass lamp with the copper coin ('buy lamp'). " +
             "You'll want a convincing fake later.";
    }
    if (!f.has('gate_scene')) {
      return "Walk north to the castle gate and see what you're up against.";
    }
    if (!f.has('gnomes_fooled')) {
      return "Travel to the Isle of Wonder ('travel wonder'). The gnome " +
             "sentries want a wonder — give them a show: 'together perform " +
             "show'.";
    }
    if (!f.has('mint_taken')) return "Pick the silver mint on the Isle of Wonder ('take mint').";
    if (!f.has('cliffs_done')) {
      return "Travel to the Sacred Mountain ('travel sacred'). Each of you " +
             "must answer the riddle on your own carving ('answer <word>').";
    }
    if (!f.has('oracle_told')) {
      return "Climb UP to the summit and give the mint to the Oracle ('give " +
             "mint to oracle').";
    }
    if (!f.has('torch_lit')) {
      return 'Enter the catacombs (NORTH from the cliffs) and light the wall ' +
             "torch with the tinder box ('light torch').";
    }
    if (!f.has('minotaur_defeated')) {
      if (!partyHas('red cape')) return 'Take the red cape from the niche in the catacombs.';
      return "Bullfight: 'together fight minotaur' — both of you.";
    }
    if (!f.has('lamp_swapped')) {
      if (!['catacombs', 'cellar', 'throne'].includes(state.location)) {
        return "The catacombs' north passage leads under the sea to the " +
               'castle cellars, and the throne room is above.';
      }
      return "Head north and up to the throne room, then 'together swap " +
             "lamp' — both of you.";
    }
    if (!state.won) return 'Finish it: USE LAMP.';
    return "You've won! The Maroon Isles are saved.";
  }

  return {
    state, emit, flush, onChange, handle, sidebar, describeRoom,
    name, other, partyHas,
  };
}
