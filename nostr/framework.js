class GameFramework {
    constructor(gameConfig) {
        this.config = gameConfig;
        this.nostr = new NostrClient();
        this.gameCode = '';
        this.playerName = '';
        this.players = [];
        this.currentPlayer = 0;
        this.phase = 'lobby';
        this.isHost = false;
        this.processedEvents = new Set();
        
        this.setupUI();
        this.init();
    }
    
    async setupIdentity() {
        window.identity = new Identity();
        if (!window.identity.loadFromStorage()) {
            window.identity.generateNew();
        }
    }
    
    async init() {
        await this.setupIdentity();
        this.checkURLParams();
        await this.loadState();
    }

    checkURLParams() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code) {
            document.getElementById('gameCode').value = code.toUpperCase();
            
            // Hide new game button when joining via URL
            const newBtn = document.getElementById('newBtn');
            if (newBtn) newBtn.style.display = 'none';
            
            // Load saved name or prompt for name
            const savedName = Storage.getCookie('playerName');
            const nameInput = document.getElementById('playerName');
            
            if (savedName) {
                nameInput.value = savedName;
                // Don't auto-join, let user click join button
            } else {
                // Focus name input for quick joining
                nameInput.focus();
                nameInput.placeholder = 'Enter your name to join';
            }
        } else {
            // Load saved name for regular use
            const savedName = Storage.getCookie('playerName');
            if (savedName) {
                document.getElementById('playerName').value = savedName;
            }
        }
    }

    setupUI() {
        document.getElementById('newBtn').onclick = () => this.newGame();
        document.getElementById('joinBtn').onclick = () => this.joinGame();
        document.getElementById('startBtn').onclick = () => this.startGame();
        document.getElementById('syncBtn').onclick = () => this.syncGame();
        document.getElementById('quitBtn').onclick = () => this.quitGame();
        
        // Burger menu - set up later when elements exist
        setTimeout(() => this.setupBurgerMenu(), 100);
        
        // Enter key support
        document.getElementById('playerName').onkeypress = (e) => {
            if (e.key === 'Enter') {
                const code = document.getElementById('gameCode').value.trim();
                if (code) {
                    this.joinGame();
                } else {
                    this.newGame();
                }
            }
        };
        
        document.getElementById('gameCode').onkeypress = (e) => {
            if (e.key === 'Enter') this.joinGame();
        };
    }

    generateCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    async newGame() {
        this.playerName = document.getElementById('playerName').value.trim().toLowerCase();
        if (!this.playerName) {
            console.log('Name is required');
            return;
        }
        
        console.log(`[NEW GAME] Starting new game for ${this.playerName}`);
        
        // Clear any existing state first
        Storage.deleteCookie('gameState');
        this.processedEvents.clear();
        this.resetGameState();
        
        // Save name to cookie
        Storage.setCookie('playerName', this.playerName);
        
        this.gameCode = this.generateCode();
        this.isHost = true;
        this.phase = 'lobby';
        this.players = [{ id: window.identity.pubkey, name: this.playerName, joinTime: Date.now() }];
        this.currentPlayer = 0;
        
        console.log(`[NEW GAME] Set isHost=true, phase=lobby, players=${this.players.length}`);
        
        document.getElementById('gameCode').value = this.gameCode;
        this.saveState();
        this.subscribe();
        
        await this.nostr.publish(this.gameCode, 'join', {
            id: window.identity.pubkey,
            name: this.playerName,
            gameType: this.config.name
        });
        
        console.log(`[NEW GAME] About to call updateUI - isHost: ${this.isHost}, phase: ${this.phase}, players: ${this.players.length}`);
        this.updateUI();
        this.onGameCreated();
        
        // Ensure UI is updated after any async operations
        setTimeout(() => {
            console.log(`[NEW GAME] Delayed updateUI call`);
            console.log(`[NEW GAME] updateUI method exists: ${typeof this.updateUI}`);
            try {
                this.updateUI();
            } catch (error) {
                console.error(`[NEW GAME] updateUI error:`, error);
            }
        }, 100);
    }

    async joinGame() {
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
        
        this.players = [];
        this.currentPlayer = 0;
        this.phase = 'lobby';
        this.isHost = false;
        
        const events = await this.nostr.getHistory(this.gameCode);
        this.log(`Loading ${events.length} historical events`);
        this.processHistory(events);
        
        // Re-determine host status after loading history
        const wasHost = this.isHost;
        this.isHost = this.players[0]?.id === window.identity.pubkey;
        
        // If we were the host but lost it due to timing, reclaim it
        if (wasHost && !this.isHost && this.players.length === 1) {
            this.isHost = true;
        }
        
        this.saveState();
        this.subscribe();
        
        // Save name to cookie
        Storage.setCookie('playerName', this.playerName);
        
        if (!this.players.find(p => p.id === window.identity.pubkey)) {
            await this.nostr.publish(this.gameCode, 'join', {
                id: window.identity.pubkey,
                name: this.playerName,
                gameType: this.config.name
            });
        }
        
        this.updateUI();
        this.onGameJoined();
    }

    subscribe() {
        this.log(`Subscribing to game: ${this.gameCode}`);
        
        const sinceTimestamp = Math.floor(Date.now() / 1000);
        this.log(`Subscribing for events since: ${new Date(sinceTimestamp * 1000).toLocaleTimeString()}`);
        
        this.nostr.subscribe(this.gameCode, (event) => {
            const type = event.tags.find(t => t[0] === 'type')?.[1];
            const data = JSON.parse(event.content);
            
            this.log(`Received Nostr event: ${type}`);
            this.processEvent(type, data, event.created_at * 1000, event.id);
            this.saveState();
            this.updateUI();
        }, sinceTimestamp);
    }

    processHistory(events) {
        events.forEach(event => {
            const type = event.tags.find(t => t[0] === 'type')?.[1];
            const data = JSON.parse(event.content);
            this.processEvent(type, data, event.created_at * 1000, event.id);
        });
    }

    processEvent(type, data, timestamp = Date.now(), eventId = null) {
        if (eventId && this.processedEvents.has(eventId)) {
            this.log(`Skipping already processed event: ${type} (${eventId?.slice(0,8)})`);
            return;
        }
        
        this.log(`Processing event: ${type} from ${data.name || data.id?.slice(0,8)} (${eventId?.slice(0,8) || 'no-id'})`);
        
        if (eventId) {
            this.processedEvents.add(eventId);
        }
        
        switch (type) {
            case 'join':
                // Check if this is the right game type
                if (data.gameType && data.gameType !== this.config.name) {
                    this.log(`Ignoring join from different game type: ${data.gameType}`);
                    return;
                }
                
                const existingPlayer = this.players.find(p => p.name.toLowerCase() === data.name.toLowerCase());
                if (!existingPlayer) {
                    // Enforce max players
                    if (this.players.length >= this.config.maxPlayers) {
                        this.log(`Game full, ignoring join from ${data.name}`);
                        return;
                    }
                    this.players.push({ ...data, joinTime: timestamp });
                    this.players.sort((a, b) => (a.joinTime || 0) - (b.joinTime || 0));
                    this.log(`Player ${data.name} joined. Total players: ${this.players.length}`);
                } else {
                    this.log(`Player ${data.name} already in game, ignoring duplicate join`);
                }
                break;
            case 'start':
                this.phase = 'playing';
                this.currentPlayer = 0;
                this.resetGameState();
                this.log(`Game started. First player: ${this.players[0]?.name}`);
                this.onGameStarted();
                break;
            default:
                this.onGameEvent(type, data, timestamp, eventId);
                break;
        }
    }

    async startGame() {
        if (!this.isHost || this.players.length < this.config.minPlayers) return;
        
        await this.nostr.publish(this.gameCode, 'start', {});
        this.phase = 'playing';
        this.currentPlayer = 0;
        this.saveState();
        this.updateUI();
    }

    async makeMove(moveType, moveData) {
        if (this.phase !== 'playing') return;
        if (this.players[this.currentPlayer]?.id !== window.identity.pubkey) return;
        
        await this.nostr.publish(this.gameCode, moveType, {
            id: window.identity.pubkey,
            name: this.playerName,
            ...moveData
        });
    }

    nextTurn() {
        this.currentPlayer = (this.currentPlayer + 1) % this.players.length;
        this.log(`Next turn: ${this.players[this.currentPlayer]?.name} (index ${this.currentPlayer})`);
    }

    saveState() {
        const state = {
            gameCode: this.gameCode,
            playerName: this.playerName,
            players: this.players,
            currentPlayer: this.currentPlayer,
            phase: this.phase,
            isHost: this.isHost,
            gameState: this.getGameState()
        };
        Storage.setCookie('gameState', JSON.stringify(state));
        this.updateDebug();
    }

    async loadState() {
        const state = Storage.getCookie('gameState');
        if (state) {
            console.log(`[LOAD STATE] Found saved state`);
            const data = JSON.parse(state);
            this.gameCode = data.gameCode || '';
            this.playerName = data.playerName || '';
            this.players = data.players || [];
            this.currentPlayer = data.currentPlayer || 0;
            this.phase = data.phase || 'lobby';
            
            this.loadGameState(data.gameState);
            
            if (this.gameCode && this.playerName && this.players.length > 0) {
                console.log(`[LOAD STATE] Restoring game: ${this.gameCode}, players: ${this.players.length}`);
                document.getElementById('gameCode').value = this.gameCode;
                document.getElementById('playerName').value = this.playerName;
                
                this.processedEvents.clear();
                this.log('Cleared processed events for fresh subscription');
                
                // Recalculate host status based on current players
                const oldHost = this.isHost;
                this.isHost = this.players[0]?.id === window.identity.pubkey;
                console.log(`[LOAD STATE] Host status: ${oldHost} -> ${this.isHost}`);
                
                // Auto-rejoin
                if (this.players.find(p => p.id === window.identity.pubkey)) {
                    this.onGameJoined();
                }
                
                this.subscribe();
            } else {
                console.log(`[LOAD STATE] Not restoring - missing data or no players`);
            }
        } else {
            console.log(`[LOAD STATE] No saved state found`);
        }
        this.updateUI();
    }

    updateUI() {
        try {
            console.log(`[UPDATE UI] Step 1 - Starting updateUI - gameCode: ${this.gameCode}, playerName: ${this.playerName}`);
            
            // Show/hide sections based on game state
            const lobbySection = document.getElementById('lobbySection');
            const gameSection = document.getElementById('gameSection');
            
            console.log(`[UPDATE UI] Step 2 - Found elements - lobby: ${!!lobbySection}, game: ${!!gameSection}`);
            
            if (this.gameCode && this.playerName) {
                console.log(`[UPDATE UI] Step 3 - Showing game section`);
                lobbySection.style.display = 'none';
                gameSection.style.display = 'block';
                
                console.log(`[UPDATE UI] Step 4 - Updated section visibility`);
                
                // Update share URL - only show in lobby phase
                const shareUrlDiv = document.getElementById('shareUrl');
                const shareUrlInput = document.getElementById('shareUrlInput');
                if (shareUrlDiv && shareUrlInput) {
                    if (this.phase === 'lobby') {
                        shareUrlDiv.style.display = 'block';
                        shareUrlInput.value = `${window.location.origin}${window.location.pathname}?code=${this.gameCode}`;
                    } else {
                        shareUrlDiv.style.display = 'none';
                    }
                }
                console.log(`[UPDATE UI] Step 5 - Updated share URL`);
            } else {
                console.log(`[UPDATE UI] Step 3 - Showing lobby section`);
                lobbySection.style.display = 'block';
                gameSection.style.display = 'none';
            }
            
            console.log(`[UPDATE UI] Step 6 - Setting status`);
            let status = '';
            if (this.phase === 'lobby') {
                status = `Players: ${this.players.length}/${this.config.maxPlayers}`;
            } else if (this.phase === 'playing') {
                const current = this.players[this.currentPlayer];
                const isMyTurn = current?.id === window.identity.pubkey;
                status = isMyTurn ? 'Your turn' : `${current?.name}'s turn`;
            } else if (this.phase === 'finished') {
                status = this.getWinnerText();
            }
            
            const statusEl = document.getElementById('gameStatus');
            if (statusEl) statusEl.textContent = status;
            
            console.log(`[UPDATE UI] Step 7 - Looking for start button`);
            const startBtn = document.getElementById('startBtn');
            console.log(`[START BTN] Element found: ${!!startBtn}`);
            if (startBtn) {
                const shouldShow = this.phase !== 'playing';
                const shouldEnable = this.isHost && this.phase === 'lobby' && this.players.length >= this.config.minPlayers;
                
                console.log(`[START BTN] Phase: ${this.phase}, IsHost: ${this.isHost}, Players: ${this.players.length}/${this.config.minPlayers}, ShouldShow: ${shouldShow}, ShouldEnable: ${shouldEnable}`);
                
                if (shouldShow) {
                    startBtn.style.display = 'inline-block';
                    startBtn.disabled = !shouldEnable;
                } else {
                    startBtn.style.display = 'none';
                }
            }
            
            console.log(`[UPDATE UI] Step 8 - Calling updateGameUI`);
            this.updateGameUI();
            console.log(`[UPDATE UI] Step 9 - Calling updateDebug`);
            this.updateDebug();
            console.log(`[UPDATE UI] Step 10 - Completed updateUI`);
        } catch (error) {
            console.error(`[UPDATE UI] ERROR:`, error);
        }
    }

    updateDebug() {
        const myId = window.identity?.pubkey;
        if (!myId) return;
        
        const currentPlayerId = this.players[this.currentPlayer]?.id;
        const isMyTurn = currentPlayerId === myId;
        
        const debugInfo = [
            `Game: ${this.config.title}`,
            `Game Code: ${this.gameCode}`,
            `Phase: ${this.phase}`,
            `My ID: ${myId.slice(0, 8)}...`,
            `My Name: ${this.playerName}`,
            `Is Host: ${this.isHost}`,
            `Current Player Index: ${this.currentPlayer}`,
            `Current Player ID: ${currentPlayerId ? currentPlayerId.slice(0, 8) + '...' : 'none'}`,
            `Is My Turn: ${isMyTurn}`,
            `Players (${this.players.length}):`
        ];
        
        this.players.forEach((p, i) => {
            const joinTime = p.joinTime ? new Date(p.joinTime).toLocaleTimeString() : 'unknown';
            const isCurrent = i === this.currentPlayer ? ' <- CURRENT' : '';
            debugInfo.push(`  ${i}: ${p.name} (${p.id.slice(0, 8)}...) joined: ${joinTime}${isCurrent}`);
        });
        
        debugInfo.push(`Last Update: ${new Date().toLocaleTimeString()}`);
        
        const debugDiv = document.getElementById('debugContent');
        if (debugDiv) {
            debugDiv.innerHTML = debugInfo.join('<br>');
        }
    }

    async syncGame() {
        if (!this.gameCode) return;
        
        this.log('Syncing game state...');
        
        this.players = [];
        this.currentPlayer = 0;
        this.phase = 'lobby';
        this.isHost = false;
        this.processedEvents.clear();
        this.resetGameState();
        
        const events = await this.nostr.getHistory(this.gameCode);
        this.log(`Processing ${events.length} events`);
        this.processHistory(events);
        
        // Re-determine host status after sync
        this.isHost = this.players[0]?.id === window.identity.pubkey;
        
        this.saveState();
        this.updateUI();
        this.log('Sync complete');
    }

    log(message) {
        console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
        const debugDiv = document.getElementById('debugContent');
        if (debugDiv) {
            debugDiv.innerHTML += `<br><strong>[${new Date().toLocaleTimeString()}] ${message}</strong>`;
            debugDiv.scrollTop = debugDiv.scrollHeight;
        }
    }

    setupBurgerMenu() {
        const burgerBtn = document.getElementById('burgerBtn');
        const burgerContent = document.getElementById('burgerContent');
        
        if (burgerBtn && burgerContent) {
            burgerBtn.onclick = (e) => {
                e.stopPropagation();
                burgerContent.classList.toggle('show');
            };
            
            document.onclick = () => {
                burgerContent.classList.remove('show');
            };
            
            burgerContent.onclick = (e) => {
                e.stopPropagation();
            };
        }
    }
    
    quitGame() {
        Storage.deleteCookie('gameState');
        this.gameCode = '';
        this.playerName = '';
        this.players = [];
        this.phase = 'lobby';
        this.isHost = false;
        this.processedEvents.clear();
        this.resetGameState();
        
        // Reset UI elements
        document.getElementById('playerName').value = Storage.getCookie('playerName') || '';
        document.getElementById('gameCode').value = '';
        document.getElementById('playerName').style.display = 'block';
        document.getElementById('newBtn').style.display = 'inline-block';
        document.getElementById('joinBtn').style.display = 'inline-block';
        
        this.updateUI();
        window.location.href = window.location.pathname;
    }
    
    // Override these methods in your game
    onGameCreated() {}
    onGameJoined() {}
    onGameStarted() {}
    onGameEvent(type, data, timestamp, eventId) {}
    updateGameUI() {}
    getGameState() { return {}; }
    loadGameState(state) {}
    resetGameState() {}
    getWinnerText() { return 'Game finished!'; }
}