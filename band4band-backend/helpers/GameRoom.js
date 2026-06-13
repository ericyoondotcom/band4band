import plaidService from './PlaidService.js';
import geminiService from './GeminiService.js';
import * as Prompts from './prompts.js';

const RECONNECT_GRACE_MS = 30_000; // 30 seconds

export default class GameRoom {
  constructor(roomId, onEmpty) {
    this.roomId = roomId;
    this.players = {}; // Key: socketId, Value: PlayerData
    this.hostId = null;
    this.state = 'LOBBY'; // LOBBY, CONFIG, GENERATING, PLAYING
    this.settings = { numVerses: 8 };
    this.onEmpty = onEmpty;
    // Stored after generation completes so reconnecting players can receive it
    this.lastBattleSequence = null;
    this.lastBeatSeed = null;
  }

  /**
   * Generate a random reconnect token for a player.
   */
  _generateReconnectId() {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }

  addPlayer(socket, isHost) {
    if (Object.keys(this.players).length >= 2) {
      throw new Error("Room is full");
    }

    if (isHost) {
      this.hostId = socket.id;
    }

    const reconnectId = this._generateReconnectId();

    this.players[socket.id] = {
      socket,
      reconnectId,
      name: '',
      nickname: '',
      accessTokens: [],
      isReady: false,
      versesConfig: null,
      financialData: null,
      disconnectTimer: null
    };

    this._attachSocketHandlers(socket);

    // Send the reconnect token to the client so it can rejoin after a disconnect
    socket.send(JSON.stringify({ type: 'SESSION_TOKEN', reconnectId, roomCode: this.roomId }));

    this.broadcastState();
  }

  /**
   * Reconnect an existing player slot to a new socket.
   * Called by index.js when a client presents a valid reconnectId.
   */
  reconnectPlayer(socket, reconnectId) {
    const entry = Object.values(this.players).find(p => p.reconnectId === reconnectId);
    if (!entry) {
      throw new Error('Invalid reconnect token');
    }

    // Cancel the pending destroy timer
    if (entry.disconnectTimer) {
      clearTimeout(entry.disconnectTimer);
      entry.disconnectTimer = null;
    }

    // Remap under the new socket id
    const oldSocketId = Object.keys(this.players).find(id => this.players[id] === entry);
    delete this.players[oldSocketId];

    entry.socket = socket;
    this.players[socket.id] = entry;

    // Update hostId if this was the host
    if (this.hostId === oldSocketId) {
      this.hostId = socket.id;
    }

    this._attachSocketHandlers(socket);

    // Send full state so the client can fast-forward to where the game is
    const reconnectPayload = {
      type: 'RECONNECTED',
      state: this.state,
      settings: this.settings,
      roomCode: this.roomId,
      reconnectId: entry.reconnectId
    };

    // If the game is already done generating, send the full battle sequence
    if (this.state === 'PLAYING' && this.lastBattleSequence) {
      reconnectPayload.sequence = this.lastBattleSequence;
      reconnectPayload.beatSeed = this.lastBeatSeed;
    }

    socket.send(JSON.stringify(reconnectPayload));
    this.broadcastState();
  }

  _attachSocketHandlers(socket) {
    socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await this.handleMessage(socket.id, data);
      } catch (e) {
        console.error("Error handling message:", e);
      }
    });

    socket.on('close', () => {
      this._handleDisconnect(socket.id);
    });
  }

  _handleDisconnect(socketId) {
    const player = this.players[socketId];
    if (!player) return;

    console.log(`[GameRoom ${this.roomId}] Player ${socketId} disconnected. Starting ${RECONNECT_GRACE_MS / 1000}s grace period.`);

    // Notify remaining players
    this.broadcast({ type: 'OPPONENT_DISCONNECTED', gracePeriodMs: RECONNECT_GRACE_MS });

    player.disconnectTimer = setTimeout(() => {
      console.log(`[GameRoom ${this.roomId}] Grace period expired for ${socketId}. Destroying room.`);
      this.removePlayer(socketId);
    }, RECONNECT_GRACE_MS);
  }

  removePlayer(socketId) {
    const player = this.players[socketId];
    if (player && player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }
    delete this.players[socketId];

    if (Object.keys(this.players).length === 0) {
      this.destroy();
    } else {
      // If one player permanently leaves, the game is over
      this.destroy();
    }
  }

  async handleMessage(socketId, data) {
    const player = this.players[socketId];

    switch (data.type) {
      case 'SET_PROFILE':
        player.name = data.name;
        player.nickname = data.nickname;
        this.broadcastState();
        break;
      
      case 'EXCHANGE_PUBLIC_TOKEN':
        try {
          const accessToken = await plaidService.exchangePublicToken(data.publicToken);
          player.accessTokens.push(accessToken);
          player.socket.send(JSON.stringify({ type: 'TOKEN_EXCHANGED', accessToken }));
          this.broadcastState();
        } catch (e) {
          player.socket.send(JSON.stringify({ type: 'ERROR', message: 'Failed to link bank' }));
        }
        break;

      case 'RESTORE_ACCESS_TOKENS':
        if (data.accessTokens && Array.isArray(data.accessTokens)) {
          // Add only unique tokens
          const newTokens = data.accessTokens.filter(t => !player.accessTokens.includes(t));
          player.accessTokens.push(...newTokens);
          this.broadcastState();
        }
        break;

      case 'SET_READY':
        player.isReady = true;
        this.broadcastState();
        this.checkLobbyReady();
        break;

      case 'START_PLAYBACK':
        this.broadcast({ type: 'START_PLAYBACK' });
        break;

      case 'SUBMIT_VERSES':
        player.versesConfig = data.verses; // Array of configs
        this.checkVersesReady();
        break;

      case 'SET_SETTINGS':
        if (socketId === this.hostId) {
          this.settings.numVerses = data.numVerses;
          this.broadcastState();
        }
        break;
    }
  }

  checkLobbyReady() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length === 2) {
      const allReady = playerIds.every(id => this.players[id].isReady && this.players[id].accessTokens.length > 0 && this.players[id].nickname);
      if (allReady) {
        this.state = 'CONFIG';
        this.broadcastState();
      }
    }
  }

  async checkVersesReady() {
    const playerIds = Object.keys(this.players);
    if (playerIds.length === 2) {
      const allConfigured = playerIds.every(id => this.players[id].versesConfig);
      if (allConfigured) {
        this.state = 'GENERATING';
        this.broadcastState();
        await this.generateGame();
      }
    }
  }

  async generateGame() {
    const playerIds = Object.keys(this.players);
    const p1 = this.players[playerIds[0]];
    const p2 = this.players[playerIds[1]];

    try {
      // Fetch financial data for all linked banks
      p1.financialData = await plaidService.getFinancialData(p1.accessTokens);
      p2.financialData = await plaidService.getFinancialData(p2.accessTokens);

      // Generate Prompts
      const p1PromptsData = p1.versesConfig.map(config => this.buildPrompt(config, p1, p2));
      const p2PromptsData = p2.versesConfig.map(config => this.buildPrompt(config, p2, p1));

      const p1Prompts = p1PromptsData.map(d => d.prompt);
      const p2Prompts = p2PromptsData.map(d => d.prompt);
      
      const p1Contexts = p1PromptsData.map(d => d.context);
      const p2Contexts = p2PromptsData.map(d => d.context);

      let versesGenerated = 0;
      let audioGenerated = 0;

      const broadcastProgress = () => {
        this.broadcast({
          type: 'GENERATION_PROGRESS',
          versesGenerated,
          audioGenerated,
          total: this.settings.numVerses * 2
        });
      };

      // Call Gemini for verses
      const { player1Verses, player2Verses } = await geminiService.generateAllVerses(p1Prompts, p2Prompts, () => {
        versesGenerated++;
        broadcastProgress();
      });

      const p1Voice = 'Puck'; // Male voice
      const p2Voice = 'Aoede'; // Female voice

      // Prepare interleaved lyrics
      const battleSequence = [];
      for (let i = 0; i < this.settings.numVerses; i++) {
        battleSequence.push({
          playerId: playerIds[0],
          nickname: p1.nickname,
          name: p1.name,
          voice: p1Voice,
          ttsPrompt: Prompts.PROMPT_TTS_PLAYER1,
          lines: player1Verses[i].split('\n').filter(l => l.trim() !== ''),
          context: p1Contexts[i],
          audioData: null
        });
        battleSequence.push({
          playerId: playerIds[1],
          nickname: p2.nickname,
          name: p2.name,
          voice: p2Voice,
          ttsPrompt: Prompts.PROMPT_TTS_PLAYER2,
          lines: player2Verses[i].split('\n').filter(l => l.trim() !== ''),
          context: p2Contexts[i],
          audioData: null
        });
      }

      // Generate audio chunks for all verses in batches of 2
      // Gemini TTS quota is 10 requests/minute, so we throttle carefully
      const BATCH_SIZE = 2;
      for (let i = 0; i < battleSequence.length; i += BATCH_SIZE) {
        const batch = battleSequence.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(verseObj => {
          const fullVerseText = verseObj.lines.join('\n');
          return geminiService.generateAudioForVerse(fullVerseText, verseObj.voice, verseObj.ttsPrompt).then(wavDataUri => {
            verseObj.audioData = wavDataUri;
            audioGenerated++;
            broadcastProgress();
          });
        });
        await Promise.all(batchPromises);

        // Pause between batches to avoid hitting 10 RPM rate limit
        if (i + BATCH_SIZE < battleSequence.length) {
          await new Promise(resolve => setTimeout(resolve, 6000));
        }
      }

      this.state = 'PLAYING';

      // Debug: check audio data presence before broadcasting
      battleSequence.forEach((v, i) => {
        if (!v.audioData) {
          console.error(`[GameRoom] WARN: verse ${i} (${v.nickname}) has null audioData!`);
        } else {
          console.log(`[GameRoom] Verse ${i} audioData OK, prefix: ${v.audioData.substring(0, 40)}`);
        }
      });

      // Cache for reconnecting players
      this.lastBattleSequence = battleSequence;
      this.lastBeatSeed = Math.random();

      this.broadcast({
        type: 'GAME_READY',
        sequence: battleSequence,
        beatSeed: this.lastBeatSeed
      });

    } catch (e) {
      console.error("Error generating game:", e);
      this.broadcast({ type: 'ERROR', message: 'Failed to generate battle' });
    }
  }

  buildPrompt(config, me, opponent) {
    let template = '';
    let context = { type: config.topic };
    
    if (config.type === 'BRAG') {
      if (config.topic === 'NET_WORTH') {
        template = Prompts.PROMPT_BRAG_NET_WORTH;
        context.data = me.financialData.netWorth;
      } else if (config.topic === 'PURCHASES') {
        template = Prompts.PROMPT_BRAG_PURCHASES;
        context.data = me.financialData.recentPurchases;
      } else if (config.topic === 'INCOME') {
        template = Prompts.PROMPT_BRAG_INCOME;
        context.data = me.financialData.incomeSources;
      } else if (config.topic === 'SPENDING_HABITS') {
        template = Prompts.PROMPT_BRAG_SPENDING_HABITS;
        context.data = me.financialData.spendingCategories;
      }
      
      template = template
        .replace('{{NET_WORTH}}', me.financialData.netWorth)
        .replace('{{RECENT_PURCHASES}}', me.financialData.recentPurchases.map(p => `${p.name} ($${Math.round(p.amount)})`).join(', '))
        .replace('{{INCOME_SOURCES}}', me.financialData.incomeSources.join(', '))
        .replace('{{SPENDING_CATEGORIES}}', me.financialData.spendingCategories.map(c => `${c.category} ($${Math.round(c.amount)})`).join(', '));
    } else {
      if (config.topic === 'NET_WORTH') {
        template = Prompts.PROMPT_DISS_NET_WORTH;
        context.data = opponent.financialData.netWorth;
      } else if (config.topic === 'PURCHASES') {
        template = Prompts.PROMPT_DISS_PURCHASES;
        context.data = opponent.financialData.recentPurchases;
      } else if (config.topic === 'INCOME') {
        template = Prompts.PROMPT_DISS_INCOME;
        context.data = opponent.financialData.incomeSources;
      } else if (config.topic === 'SPENDING_HABITS') {
        template = Prompts.PROMPT_DISS_SPENDING_HABITS;
        context.data = opponent.financialData.spendingCategories;
      }

      template = template
        .replace(/{{OPPONENT_NICKNAME}}/g, opponent.nickname)
        .replace('{{OPPONENT_NET_WORTH}}', opponent.financialData.netWorth)
        .replace('{{OPPONENT_RECENT_PURCHASES}}', opponent.financialData.recentPurchases.map(p => `${p.name} ($${Math.round(p.amount)})`).join(', '))
        .replace('{{OPPONENT_INCOME_SOURCES}}', opponent.financialData.incomeSources.join(', '))
        .replace('{{OPPONENT_SPENDING_CATEGORIES}}', opponent.financialData.spendingCategories.map(c => `${c.category} ($${Math.round(c.amount)})`).join(', '));
    }

    return { prompt: template, context };
  }

  broadcast(messageObj) {
    const msgString = JSON.stringify(messageObj);
    Object.values(this.players).forEach(p => {
      if (p.socket && p.socket.readyState === 1) { // OPEN
        p.socket.send(msgString);
      }
    });
  }

  broadcastState() {
    const playersInfo = Object.values(this.players).map(p => ({
      name: p.name,
      nickname: p.nickname,
      isHost: p.socket.id === this.hostId,
      linkedCount: p.accessTokens.length,
      isReady: p.isReady
    }));

    this.broadcast({
      type: 'STATE_UPDATE',
      state: this.state,
      players: playersInfo,
      settings: this.settings
    });
  }

  destroy() {
    console.log(`Destroying room ${this.roomId}`);
    // Cancel any pending grace period timers
    Object.values(this.players).forEach(p => {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    });
    // Notify remaining connected players
    this.broadcast({ type: 'ROOM_DESTROYED', message: 'The room has been closed.' });
    // Clear sensitive data
    Object.values(this.players).forEach(p => {
      p.accessTokens = [];
      p.financialData = null;
      if (p.socket && p.socket.readyState === 1) {
        p.socket.close();
      }
    });
    this.players = {};
    this.lastBattleSequence = null;
    if (this.onEmpty) {
      this.onEmpty(this.roomId);
    }
  }
}
