import plaidService from './PlaidService.js';
import geminiService from './GeminiService.js';
import * as Prompts from './prompts.js';

export default class GameRoom {
  constructor(roomId, onEmpty) {
    this.roomId = roomId;
    this.players = {}; // Key: socketId, Value: PlayerData
    this.hostId = null;
    this.state = 'LOBBY'; // LOBBY, CONFIG, GENERATING, PLAYING
    this.settings = { numVerses: 8 };
    this.onEmpty = onEmpty;
  }

  addPlayer(socket, isHost) {
    if (Object.keys(this.players).length >= 2) {
      throw new Error("Room is full");
    }

    if (isHost) {
      this.hostId = socket.id;
    }

    this.players[socket.id] = {
      socket,
      name: '',
      nickname: '',
      accessTokens: [],
      isReady: false,
      versesConfig: null,
      financialData: null
    };

    socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        await this.handleMessage(socket.id, data);
      } catch (e) {
        console.error("Error handling message:", e);
      }
    });

    socket.on('close', () => {
      this.removePlayer(socket.id);
    });

    this.broadcastState();
  }

  removePlayer(socketId) {
    delete this.players[socketId];
    if (Object.keys(this.players).length === 0) {
      this.destroy();
    } else {
      // If one leaves, the game is over as per requirements
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

      this.broadcast({
        type: 'GAME_READY',
        sequence: battleSequence,
        beatSeed: Math.random()
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
      if (p.socket.readyState === 1) { // OPEN
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
    // Clear sensitive data
    Object.values(this.players).forEach(p => {
      p.accessTokens = [];
      p.financialData = null;
      if (p.socket.readyState === 1) {
        p.socket.close();
      }
    });
    this.players = {};
    if (this.onEmpty) {
      this.onEmpty(this.roomId);
    }
  }
}
