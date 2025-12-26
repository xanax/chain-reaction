class LocalGameFramework {
    constructor(gameConfig) {
        this.config = gameConfig;
        this.gameCode = '';
        this.playerName = '';
        this.players = [];
        this.currentPlayer = 0;
        this.phase = 'lobby';
        this.isHost = false;
        this.myPlayerId = this.generateId();
        
        this.setupUI();
        this.loadState();
    }

    generateId() {
        return Math.random().toString(36).substr(2, 16);
    }

    setupUI() {
        document.getElementById('newBtn').onclick = () => this.newGame();
        document.getElementById('joinBtn').onclick = () => this.joinGame();
        document.getElementById('startBtn').onclick = () => this.startGame();
        document.getElementById('syncBtn').onclick = () => this.syncGame();
    }

    generateCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    newGame() {
        this.playerName = document.getElementById('playerName').value.trim().toLowerCase();
        if (!this.playerName) {
            console.log('Name is required');
            return;
        }
        
        this.gameCode = this.generateCode();
        this.isHost = true;
        this.phase = 'lobby';
        this.players = [{ id: this.myPlayerId, name: this.playerName, joinTime: Date.now() }];
        this.currentPlayer = 0;
        
        document.getElementById('gameCode').value = this.gameCode;
        
        this.saveState();
        this.updateUI();
        this.onGameCreated();
    }

    joinGame() {
        this.playerName = document.getElementById('playerName').value.trim().toLowerCase();
        this.gameCode = document.getElementById('gameCode').value.trim().toUpperCase();
        
        if (!this.playerName) {
            console.log('Name is required');
            return;
        }
        if (!this.gameCode) {
            console.log('Game code is required');
            return;
        }
        
        // Load existing game state
        const existingState = this.getSharedGameState(this.gameCode);
        if (existingState) {
            this.players = existingState.players || [];
            this.phase = existingState.phase || 'lobby';
            this.currentPlayer = existingState.currentPlayer || 0;
        } else {
            this.players = [];
            this.phase = 'lobby';
            this.currentPlayer = 0;
        }
        
        this.isHost = this.players.length === 0;
        
        // Add player if not already in game
        if (!this.players.find(p => p.name === this.playerName)) {
            this.players.push({ id: this.myPlayerId, name: this.playerName, joinTime: Date.now() });
        }
        
        this.saveState();
        this.saveSharedGameState();
        this.updateUI();
        this.onGameJoined();
    }

    startGame() {
        if (!this.isHost || this.players.length < this.config.minPlayers) return;
        
        this.phase = 'playing';
        this.currentPlayer = 0;
        this.saveState();
        this.saveSharedGameState();
        this.updateUI();
        this.onGameStarted();
    }

    makeMove(moveType, moveData) {
        if (this.phase !== 'playing') return;
        if (this.players[this.currentPlayer]?.id !== this.myPlayerId) return;
        
        this.onGameEvent(moveType, { id: this.myPlayerId, name: this.playerName, ...moveData });
        this.saveState();
        this.saveSharedGameState();
        this.updateUI();
    }

    nextTurn() {
        this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
    }

    saveState() {
        const state = {
            gameCode: this.gameCode,
            playerName: this.playerName,
            players: this.players,
            currentPlayer: this.currentPlayer,
            phase: this.phase,
            isHost: this.isHost,
            myPlayerId: this.myPlayerId,
            gameState: this.getGameState()
        };
        localStorage.setItem('gameState', JSON.stringify(state));
    }

    loadState() {
        const state = localStorage.getItem('gameState');
        if (state) {
            const data = JSON.parse(state);
            this.gameCode = data.gameCode || '';
            this.playerName = data.playerName || '';
            this.players = data.players || [];
            this.currentPlayer = data.currentPlayer || 0;
            this.phase = data.phase || 'lobby';
            this.isHost = data.isHost || false;
            this.myPlayerId = data.myPlayerId || this.generateId();
            
            this.loadGameState(data.gameState);
            
            if (this.gameCode) {
                document.getElementById('gameCode').value = this.gameCode;
                document.getElementById('playerName').value = this.playerName;
            }
        }
        this.updateUI();
    }

    saveSharedGameState() {
        if (!this.gameCode) return;
        const sharedState = {
            players: this.players,
            phase: this.phase,
            currentPlayer: this.currentPlayer,
            gameState: this.getGameState()
        };
        localStorage.setItem(`shared_${this.gameCode}`, JSON.stringify(sharedState));
    }

    getSharedGameState(gameCode) {
        const state = localStorage.getItem(`shared_${gameCode}`);
        return state ? JSON.parse(state) : null;
    }

    updateUI() {
        let status = '';
        if (this.phase === 'lobby') {
            status = `Players: ${this.players.length}/${this.config.maxPlayers}`;
        } else if (this.phase === 'playing') {
            const current = this.players[this.currentPlayer];
            const isMyTurn = current?.id === this.myPlayerId;
            status = isMyTurn ? 'Your turn' : `${current?.name}'s turn`;
        } else if (this.phase === 'finished') {
            status = this.getWinnerText();
        }
        document.getElementById('status').textContent = status;
        
        const playersDiv = document.getElementById('players');
        playersDiv.innerHTML = this.players.map(p => `${p.name}`).join(', ');
        
        document.getElementById('startBtn').disabled = !(this.isHost && this.phase === 'lobby' && this.players.length >= this.config.minPlayers);
        
        this.updateGameUI();
    }

    syncGame() {
        if (!this.gameCode) return;
        
        const sharedState = this.getSharedGameState(this.gameCode);
        if (sharedState) {
            this.players = sharedState.players || [];
            this.phase = sharedState.phase || 'lobby';
            this.currentPlayer = sharedState.currentPlayer || 0;
            this.loadGameState(sharedState.gameState);
        }
        
        this.saveState();
        this.updateUI();
    }

    log(message) {
        console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    // Override these methods in your game
    onGameCreated() {}
    onGameJoined() {}
    onGameStarted() {}
    onGameEvent(type, data) {}
    updateGameUI() {}
    getGameState() { return {}; }
    loadGameState(state) {}
    getWinnerText() { return 'Game finished!'; }
}