# Band4Band

Band4Band is a real-time multiplayer rap battle game powered by the Plaid API and Gemini 2.5 Flash. Link your bank accounts, choose your diss/brag topics, and let the AI write and perform 16 bars of absolute fire using your actual financial data.

## Setup & Running Locally

### Backend (`band4band-backend`)

The backend runs on Node.js and uses WebSockets. It does not use a database; all game state is stored securely in RAM and wiped upon game completion or disconnection.

1. Ensure you have Node.js installed.
2. Navigate to the backend directory: `cd band4band-backend`
3. Install dependencies: `npm install`
4. Create a `.env` file in `band4band-backend` with your API keys:
   ```env
   GEMINI_API_KEY=your_gemini_key
   PLAID_CLIENT_ID=your_plaid_client_id
   PLAID_SECRET=your_plaid_secret
   PORT=8080
   ```
5. Start the server: `node index.js`

### Frontend (`band4band-web`)

The frontend is a React application built with Vite. It features a modern, high-contrast, hip-hop inspired UI.

1. Navigate to the frontend directory: `cd band4band-web`
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Open the local URL provided by Vite in two separate browser windows to test the multiplayer flow.

### Adding Music

To add your own background beats, place your MP3 files in `band4band-web/public/` and update the `DUMMY_BEAT` constant in `band4band-web/src/components/BattleArena.jsx` to point to your file and its actual BPM. You can expand this logic to select randomly from a JSON array if desired.
