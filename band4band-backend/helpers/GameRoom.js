import plaidService from './PlaidService.js';
import geminiService from './GeminiService.js';
import * as Prompts from './prompts.js';

export default class GameRoom {
  constructor(roomId, onEmpty) {
    this.roomId = roomId;
    this.players = {}; // Key: socketId, Value: PlayerData
    this.hostId = null;
    this.state = 'LOBBY'; // LOBBY, CONFIG, GENERATING, PLAYING
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
          player.socket.send(JSON.stringify({ type: 'TOKEN_EXCHANGED' }));
          this.broadcastState();
        } catch (e) {
          player.socket.send(JSON.stringify({ type: 'ERROR', message: 'Failed to link bank' }));
        }
        break;

      case 'SET_READY':
        player.isReady = true;
        this.broadcastState();
        this.checkLobbyReady();
        break;

      case 'SUBMIT_VERSES':
        player.versesConfig = data.verses; // Array of 8 configs
        this.checkVersesReady();
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
      const p1Prompts = p1.versesConfig.map(config => this.buildPrompt(config, p1, p2));
      const p2Prompts = p2.versesConfig.map(config => this.buildPrompt(config, p2, p1));

      // Call Gemini
      const { player1Verses, player2Verses } = await geminiService.generateAllVerses(p1Prompts, p2Prompts);

      // Prepare interleaved lyrics
      const battleSequence = [];
      for (let i = 0; i < 8; i++) {
        battleSequence.push({
          playerId: playerIds[0],
          nickname: p1.nickname,
          name: p1.name,
          verse: player1Verses[i]
        });
        battleSequence.push({
          playerId: playerIds[1],
          nickname: p2.nickname,
          name: p2.name,
          verse: player2Verses[i]
        });
      }

      this.state = 'PLAYING';
      this.broadcast({
        type: 'GAME_READY',
        sequence: battleSequence
      });

    } catch (e) {
      console.error("Error generating game:", e);
      this.broadcast({ type: 'ERROR', message: 'Failed to generate battle' });
    }
  }

  buildPrompt(config, me, opponent) {
    let template = '';
    
    if (config.type === 'BRAG') {
      if (config.topic === 'NET_WORTH') template = Prompts.PROMPT_BRAG_NET_WORTH;
      else if (config.topic === 'PURCHASES') template = Prompts.PROMPT_BRAG_PURCHASES;
      else if (config.topic === 'INCOME') template = Prompts.PROMPT_BRAG_INCOME;
      else if (config.topic === 'SPENDING_HABITS') template = Prompts.PROMPT_BRAG_SPENDING_HABITS;
      
      template = template
        .replace('{{NET_WORTH}}', me.financialData.netWorth)
        .replace('{{RECENT_PURCHASES}}', me.financialData.recentPurchases.join(', '))
        .replace('{{INCOME_SOURCES}}', me.financialData.incomeSources.join(', '))
        .replace('{{SPENDING_CATEGORIES}}', me.financialData.spendingCategories.join(', '));
    } else {
      if (config.topic === 'NET_WORTH') template = Prompts.PROMPT_DISS_NET_WORTH;
      else if (config.topic === 'PURCHASES') template = Prompts.PROMPT_DISS_PURCHASES;
      else if (config.topic === 'INCOME') template = Prompts.PROMPT_DISS_INCOME;
      else if (config.topic === 'SPENDING_HABITS') template = Prompts.PROMPT_DISS_SPENDING_HABITS;

      template = template
        .replace(/{{OPPONENT_NICKNAME}}/g, opponent.nickname)
        .replace('{{OPPONENT_NET_WORTH}}', opponent.financialData.netWorth)
        .replace('{{OPPONENT_RECENT_PURCHASES}}', opponent.financialData.recentPurchases.join(', '))
        .replace('{{OPPONENT_INCOME_SOURCES}}', opponent.financialData.incomeSources.join(', '))
        .replace('{{OPPONENT_SPENDING_CATEGORIES}}', opponent.financialData.spendingCategories.join(', '));
    }

    return template;
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
      players: playersInfo
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
