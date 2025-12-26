
# Chain Reaction

Chain Reaction is a fast-paced, strategic multiplayer game for 1-4 players. Players take turns placing orbs in a grid, causing chain reactions to capture cells and eliminate opponents. The last player remaining wins! Play locally with friends or seamlessly online using Nostr relays—just share a link and join instantly.

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