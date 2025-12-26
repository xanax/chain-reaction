
# Chain Reaction

Chain Reaction is a fast-paced, strategic multiplayer game for 1-4 players. Players take turns placing orbs in a grid, causing chain reactions to capture cells and eliminate opponents. The last player remaining wins! Play locally with friends or seamlessly online using Nostr relays—just share a link and join instantly.

## Nostr Multiplayer

The game uses **Nostr** (Notes and Other Stuff Transmitted by Relays) for internet multiplayer:

- **No server needed**: Uses public Nostr relays (relay.damus.io, nos.lol) to broadcast game events
- **Cryptographic identities**: Each player gets a unique keypair stored locally (nostr-tools)
- **Seamless joining**: One player creates a game, gets a 4-character code, shares a link—joiners auto-join with their saved name
- **Full encryption**: All events are properly signed using secp256k1 keys
- **Event types**: Join/Leave/Start/Move/Sync events published to relays and synced across players
- **Turn validation**: Moves are only accepted when it's your turn; explosions auto-advance turns
- **Rate limiting**: Built-in debounce (300ms) prevents accidental double-clicks from sending duplicate moves

## Getting Started

### 1. Clone the repository

```
git clone https://github.com/xanax/chain-reaction.git
cd chain-reaction
```

### 2. Install dependencies

```
npm install
```

### 3. Run the development server

```
npm run dev
```
Open the local URL shown in the terminal (usually http://localhost:5173 or similar) to view the app.


### 4. Build for production

To create a production build, run:

```
npm run build
```

This will generate static distributable files in the `dist/` directory:

- `dist/index.html`
- `dist/assets/` (JS and CSS bundles)

You can host the contents of the `dist/` folder on any static web server (such as Vercel, Netlify, GitHub Pages, nginx, Apache, etc). Simply upload or serve the files in `dist/`.

### 5. Run tests

```
npm run test
```
This will run the test suite using Vitest.