// Nostr Multiplayer Module for Chain Reaction
// Provides seamless internet multiplayer via Nostr protocol

import { generateSecretKey, getPublicKey, finalizeEvent, type UnsignedEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

export interface NostrPlayer {
  id: string;
  name: string;
  joinTime: number;
  playerNumber?: number; // 1-4
}

export interface NostrGameState {
  gameCode: string;
  phase: 'lobby' | 'playing' | 'finished';
  players: NostrPlayer[];
  currentPlayerIndex: number;
  hostId: string;
  gridState?: string; // Serialized grid
  movesMade: number;
  winner: number | null;
}

export type NostrEventType = 
  | 'join' 
  | 'leave' 
  | 'start' 
  | 'move' 
  | 'sync' 
  | 'chat'
  | 'heartbeat';

export interface NostrMoveData {
  r: number;
  c: number;
  player: number;
  moveNumber: number;
}

type EventCallback = (type: NostrEventType, data: any, senderId: string) => void;

// Cryptographic identity management using nostr-tools
class Identity {
  pubkey: string;
  private privkey: Uint8Array;
  
  constructor() {
    const keys = this.loadOrCreate();
    this.privkey = keys.privkey;
    this.pubkey = keys.pubkey;
  }
  
  private loadOrCreate(): { privkey: Uint8Array; pubkey: string } {
    const storedPrivkey = localStorage.getItem('chain_reaction_privkey');
    
    if (storedPrivkey) {
      try {
        const privkey = hexToBytes(storedPrivkey);
        const pubkey = getPublicKey(privkey);
        console.log('[Identity] Loaded existing identity:', pubkey.slice(0, 8) + '...');
        return { privkey, pubkey };
      } catch (e) {
        console.log('[Identity] Failed to load stored key, generating new');
      }
    }
    
    // Generate new keypair
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey);
    
    // Store for persistence
    localStorage.setItem('chain_reaction_privkey', bytesToHex(privkey));
    console.log('[Identity] Generated new identity:', pubkey.slice(0, 8) + '...');
    
    return { privkey, pubkey };
  }
  
  getPrivkey(): Uint8Array {
    return this.privkey;
  }
}

// Nostr relay connection manager
class NostrRelay {
  private ws: WebSocket | null = null;
  private url: string;
  private connected = false;
  private messageQueue: string[] = [];
  private subscriptions = new Map<string, { filter: any; callback: EventCallback }>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  constructor(url: string) {
    this.url = url;
  }
  
  async connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        console.log(`[Relay] Connecting to ${this.url}...`);
        this.ws = new WebSocket(this.url);
        
        this.ws.onopen = () => {
          console.log(`[Relay] Connected to ${this.url}`);
          this.connected = true;
          this.reconnectAttempts = 0;
          
          // Send queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()!;
            this.ws?.send(msg);
          }

          // Re-establish subscriptions after reconnect
          for (const [subId, { filter }] of this.subscriptions.entries()) {
            const message = JSON.stringify(['REQ', subId, filter]);
            this.ws?.send(message);
            console.log(`[Relay] Re-subscribed to ${subId} on ${this.url}`);
          }
          resolve(true);
        };
        
        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };
        
        this.ws.onerror = (error) => {
          console.error(`[Relay] Error on ${this.url}:`, error);
        };
        
        this.ws.onclose = () => {
          console.log(`[Relay] Disconnected from ${this.url}`);
          this.connected = false;
          this.attemptReconnect();
        };
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (!this.connected) {
            console.log(`[Relay] Connection timeout for ${this.url}`);
            resolve(false);
          }
        }, 5000);
        
      } catch (error) {
        console.error(`[Relay] Failed to connect to ${this.url}:`, error);
        resolve(false);
      }
    });
  }
  
  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`[Relay] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
      setTimeout(() => this.connect(), delay);
    }
  }
  
  private handleMessage(message: any[]) {
    const [type, subId, event] = message;
    
    if (type === 'EVENT' && this.subscriptions.has(subId)) {
      const { callback } = this.subscriptions.get(subId)!;
      try {
        const eventType = event.tags.find((t: string[]) => t[0] === 'type')?.[1];
        const data = JSON.parse(event.content);
        const senderId = event.pubkey || data.id;
        console.log(`[Relay] Received ${eventType} event from ${senderId?.slice(0, 8)}... via ${this.url}`);
        callback(eventType, data, senderId);
      } catch (e) {
        console.error('[Relay] Failed to parse event:', e, event);
      }
    } else if (type === 'EOSE') {
      console.log(`[Relay] End of stored events for ${subId} from ${this.url}`);
    } else if (type === 'OK') {
      const [, eventId, success, reason] = message;
      if (success) {
        console.log(`[Relay] Event ${eventId?.slice(0, 12)}... published successfully to ${this.url}`);
      } else {
        console.error(`[Relay] Event ${eventId?.slice(0, 12)}... REJECTED by ${this.url}: ${reason}`);
      }
    } else if (type === 'NOTICE') {
      console.log(`[Relay] Notice from ${this.url}: ${subId}`);
    }
  }
  
  send(message: string) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      this.messageQueue.push(message);
    }
  }
  
  subscribe(subId: string, filter: any, callback: EventCallback) {
    this.subscriptions.set(subId, { filter, callback });
    const message = JSON.stringify(['REQ', subId, filter]);
    this.send(message);
    console.log(`[Relay] Subscribed to ${subId}`);
  }
  
  unsubscribe(subId: string) {
    this.subscriptions.delete(subId);
    if (this.connected) {
      this.send(JSON.stringify(['CLOSE', subId]));
    }
  }
  
  publish(event: any) {
    const message = JSON.stringify(['EVENT', event]);
    this.send(message);
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  disconnect() {
    this.ws?.close();
    this.subscriptions.clear();
  }
}

// Main Nostr Multiplayer Manager
export class NostrMultiplayer {
  private identity: Identity;
  private relays: NostrRelay[] = [];
  private gameCode = '';
  private players: NostrPlayer[] = [];
  private phase: 'idle' | 'lobby' | 'playing' | 'finished' = 'idle';
  private currentPlayerIndex = 0;
  private hostId = '';
  private playerName = '';
  private processedEvents = new Set<string>();
  private eventCallbacks: ((type: NostrEventType, data: any, senderId: string) => void)[] = [];
  private stateCallbacks: (() => void)[] = [];
  private movesMade = 0;
  private winner: number | null = null;
  
  private readonly RELAY_URLS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
  ];
  
  constructor() {
    this.identity = new Identity();
    console.log('[NostrMultiplayer] Initialized with ID:', this.getMyId().slice(0, 8) + '...');
  }
  
  // Connect to relays
  async connect(): Promise<number> {
    console.log('[NostrMultiplayer] Connecting to relays...');
    
    const connectionPromises = this.RELAY_URLS.map(async (url) => {
      const relay = new NostrRelay(url);
      const connected = await relay.connect();
      if (connected) {
        this.relays.push(relay);
      }
      return connected;
    });
    
    await Promise.all(connectionPromises);
    
    const connectedCount = this.relays.filter(r => r.isConnected()).length;
    console.log(`[NostrMultiplayer] Connected to ${connectedCount}/${this.RELAY_URLS.length} relays`);
    
    return connectedCount;
  }
  
  // Generate a random game code
  private generateGameCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
  
  // Create a new game
  async createGame(playerName: string): Promise<string> {
    this.playerName = playerName.trim().toLowerCase();
    this.gameCode = this.generateGameCode();
    this.hostId = this.identity.pubkey;
    this.phase = 'lobby';
    this.players = [{
      id: this.identity.pubkey,
      name: this.playerName,
      joinTime: Date.now(),
      playerNumber: 1,
    }];
    this.currentPlayerIndex = 0;
    this.movesMade = 0;
    this.winner = null;
    this.processedEvents.clear();
    
    console.log(`[NostrMultiplayer] Created game: ${this.gameCode} as host`);
    
    // Save to localStorage for persistence
    this.saveState();
    
    // Subscribe to game events
    this.subscribeToGame();
    
    // Publish join event
    await this.publishEvent('join', {
      id: this.identity.pubkey,
      name: this.playerName,
    });
    
    this.notifyStateChange();
    return this.gameCode;
  }
  
  // Join an existing game
  async joinGame(gameCode: string, playerName: string): Promise<boolean> {
    this.playerName = playerName.trim().toLowerCase();
    this.gameCode = gameCode.toUpperCase();
    this.phase = 'lobby';
    this.players = [];
    this.processedEvents.clear();
    
    console.log(`[NostrMultiplayer] Joining game: ${this.gameCode} as ${this.playerName}`);
    
    // Subscribe to game events
    this.subscribeToGame();
    
    // Wait for history to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Determine if we're already in the game
    const existingPlayer = this.players.find(p => p.id === this.identity.pubkey);
    if (!existingPlayer) {
      // Add ourselves
      await this.publishEvent('join', {
        id: this.identity.pubkey,
        name: this.playerName,
      });
    }
    
    // Update host status
    if (this.players.length === 0 || this.players[0]?.id === this.identity.pubkey) {
      this.hostId = this.identity.pubkey;
    } else {
      this.hostId = this.players[0]?.id || '';
    }
    
    this.saveState();
    this.notifyStateChange();
    
    return true;
  }
  
  // Subscribe to game events
  private subscribeToGame() {
    const subId = `chain-${this.gameCode}-${Date.now()}`;
    
    // Get events from the last hour to ensure we don't miss any
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    
    const filter = {
      kinds: [1],
      '#t': [`chain-reaction-${this.gameCode}`],
      since: oneHourAgo,
      limit: 500,
    };
    
    console.log(`[NostrMultiplayer] Subscribing to game ${this.gameCode} with filter:`, filter);
    
    this.relays.forEach(relay => {
      relay.subscribe(subId, filter, (type, data, senderId) => {
        this.processEvent(type, data, senderId);
      });
    });
    
    console.log(`[NostrMultiplayer] Subscribed to game: ${this.gameCode}`);
  }
  
  // Process incoming events
  private processEvent(type: NostrEventType, data: any, senderId: string) {
    const eventKey = `${type}-${senderId}-${data.timestamp || Date.now()}`;
    
    // Deduplicate
    if (this.processedEvents.has(eventKey)) {
      console.log(`[NostrMultiplayer] Skipping duplicate event: ${type}`);
      return;
    }
    this.processedEvents.add(eventKey);
    
    console.log(`[NostrMultiplayer] Processing ${type} from ${senderId.slice(0, 8)}...`, data);
    
    // Skip move events from ourselves - we already executed them locally
    if (type === 'move' && senderId === this.identity.pubkey) {
      console.log(`[NostrMultiplayer] Skipping own move event (already executed locally)`);
      return;
    }
    
    switch (type) {
      case 'join':
        this.handleJoin(data);
        break;
      case 'leave':
        this.handleLeave(data);
        break;
      case 'start':
        this.handleStart(data);
        break;
      case 'move':
        this.handleMove(data, senderId);
        break;
      case 'sync':
        this.handleSync(data);
        break;
      default:
        // Forward to callbacks
        this.eventCallbacks.forEach(cb => cb(type, data, senderId));
    }
    
    this.saveState();
    this.notifyStateChange();
  }
  
  private handleJoin(data: { id: string; name: string }) {
    const existing = this.players.find(p => p.id === data.id || p.name.toLowerCase() === data.name.toLowerCase());
    if (existing) {
      console.log(`[NostrMultiplayer] Player ${data.name} already in game`);
      return;
    }
    
    if (this.players.length >= 4) {
      console.log(`[NostrMultiplayer] Game full, rejecting ${data.name}`);
      return;
    }
    
    const playerNumber = this.players.length + 1;
    this.players.push({
      id: data.id,
      name: data.name,
      joinTime: Date.now(),
      playerNumber,
    });
    
    // Re-determine host (first player)
    if (this.players.length > 0) {
      this.hostId = this.players[0].id;
    }
    
    console.log(`[NostrMultiplayer] ${data.name} joined as Player ${playerNumber}. Total: ${this.players.length}`);
  }
  
  private handleLeave(data: { id: string }) {
    const idx = this.players.findIndex(p => p.id === data.id);
    if (idx >= 0) {
      const player = this.players[idx];
      this.players.splice(idx, 1);
      
      // Reassign player numbers
      this.players.forEach((p, i) => {
        p.playerNumber = i + 1;
      });
      
      // Update host if needed
      if (data.id === this.hostId && this.players.length > 0) {
        this.hostId = this.players[0].id;
      }
      
      console.log(`[NostrMultiplayer] ${player.name} left. Remaining: ${this.players.length}`);
    }
  }
  
  private handleStart(data: { playerOrder?: string[] }) {
    if (this.phase === 'playing') {
      console.log(`[NostrMultiplayer] Already playing, ignoring start`);
      return;
    }
    
    this.phase = 'playing';
    this.currentPlayerIndex = 0;
    this.movesMade = 0;
    this.winner = null;
    
    // Apply player order if provided
    if (data.playerOrder) {
      const orderedPlayers: NostrPlayer[] = [];
      data.playerOrder.forEach((id, idx) => {
        const player = this.players.find(p => p.id === id);
        if (player) {
          player.playerNumber = idx + 1;
          orderedPlayers.push(player);
        }
      });
      this.players = orderedPlayers;
    }
    
    console.log(`[NostrMultiplayer] Game started! Player order:`, this.players.map(p => p.name));
    
    // Notify callbacks
    this.eventCallbacks.forEach(cb => cb('start', { players: this.players }, this.hostId));
  }
  
  private handleMove(data: NostrMoveData, senderId: string) {
    console.log(`[NostrMultiplayer] Move received:`, data);

    // Ignore stale/duplicate move numbers (can happen when relays replay history on reconnect)
    if (data.moveNumber <= this.movesMade) {
      console.log(
        `[NostrMultiplayer] Ignoring stale move (moveNumber ${data.moveNumber} <= movesMade ${this.movesMade})`
      );
      return;
    }

    // Forward to game. We intentionally do NOT mutate movesMade/currentPlayerIndex here;
    // ChainReactionApp advances turns based on actual game logic (including explosion chains).
    this.eventCallbacks.forEach(cb => cb('move', data, senderId));
  }
  
  private handleSync(data: NostrGameState) {
    console.log(`[NostrMultiplayer] Sync received from host`);
    this.players = data.players;
    this.currentPlayerIndex = data.currentPlayerIndex;
    this.phase = data.phase;
    this.movesMade = data.movesMade;
    this.winner = data.winner;
    
    // Forward to game for grid sync
    this.eventCallbacks.forEach(cb => cb('sync', data, this.hostId));
  }
  
  // Publish an event with proper cryptographic signing
  async publishEvent(type: NostrEventType, data: any) {
    const unsignedEvent: UnsignedEvent = {
      kind: 1,
      pubkey: this.identity.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', `chain-reaction-${this.gameCode}`],
        ['type', type],
        ['game', this.gameCode],
      ],
      content: JSON.stringify({
        ...data,
        timestamp: Date.now(),
      }),
    };
    
    // Sign the event using nostr-tools
    const signedEvent = finalizeEvent(unsignedEvent, this.identity.getPrivkey());
    console.log(`[NostrMultiplayer] Signed event with id: ${signedEvent.id.slice(0, 16)}...`);
    
    this.relays.forEach(relay => {
      relay.publish(signedEvent);
    });
    
    console.log(`[NostrMultiplayer] Published ${type} to ${this.relays.length} relays`);
  }
  
  // Start the game (host only)
  async startGame(): Promise<boolean> {
    if (!this.isHost()) {
      console.log('[NostrMultiplayer] Only host can start the game');
      return false;
    }
    
    if (this.players.length < 2) {
      console.log('[NostrMultiplayer] Need at least 2 players to start');
      return false;
    }
    
    console.log(`[NostrMultiplayer] Starting game with ${this.players.length} players`);
    
    // Shuffle player order for random start
    const shuffledPlayers = [...this.players];
    for (let i = shuffledPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
    }
    
    // Update players array with shuffled order and new player numbers
    this.players = shuffledPlayers.map((p, idx) => ({
      ...p,
      playerNumber: idx + 1,
    }));
    
    console.log(`[NostrMultiplayer] Randomized player order:`, this.players.map(p => p.name));
    
    await this.publishEvent('start', {
      playerOrder: this.players.map(p => p.id),
    });
    
    this.phase = 'playing';
    this.currentPlayerIndex = 0;
    this.saveState();
    this.notifyStateChange();
    
    return true;
  }
  
  // Make a move
  async makeMove(r: number, c: number, opts?: { skipTurnCheck?: boolean }): Promise<boolean> {
    if (!opts?.skipTurnCheck && !this.isMyTurn()) {
      console.log('[NostrMultiplayer] Not your turn!');
      return false;
    }
    
    const moveData: NostrMoveData = {
      r,
      c,
      player: this.getMyPlayerNumber(),
      moveNumber: this.movesMade + 1,
    };
    
    console.log(`[NostrMultiplayer] Making move:`, moveData);
    
    await this.publishEvent('move', moveData);
    
    return true;
  }
  
  // Advance to next player
  advancePlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    this.movesMade++;
    console.log(`[NostrMultiplayer] Next player: ${this.getCurrentPlayer()?.name} (index ${this.currentPlayerIndex})`);
  }
  
  // Set winner
  setWinner(playerNumber: number) {
    this.winner = playerNumber;
    this.phase = 'finished';
    console.log(`[NostrMultiplayer] Game ended! Winner: Player ${playerNumber}`);
    this.saveState();
    this.notifyStateChange();
  }
  
  // Leave the game
  async leaveGame() {
    if (this.gameCode) {
      await this.publishEvent('leave', {
        id: this.identity.pubkey,
      });
    }
    
    this.reset();
    this.notifyStateChange();
  }
  
  private reset() {
    this.gameCode = '';
    this.players = [];
    this.phase = 'idle';
    this.currentPlayerIndex = 0;
    this.hostId = '';
    this.movesMade = 0;
    this.winner = null;
    this.processedEvents.clear();
    localStorage.removeItem('chain_reaction_game_state');
  }
  
  // Save state to localStorage
  private saveState() {
    const state = {
      gameCode: this.gameCode,
      playerName: this.playerName,
      players: this.players,
      phase: this.phase,
      currentPlayerIndex: this.currentPlayerIndex,
      hostId: this.hostId,
      movesMade: this.movesMade,
      winner: this.winner,
    };
    localStorage.setItem('chain_reaction_game_state', JSON.stringify(state));
  }
  
  // Load state from localStorage
  loadState(): boolean {
    const saved = localStorage.getItem('chain_reaction_game_state');
    if (!saved) return false;
    
    try {
      const state = JSON.parse(saved);
      this.gameCode = state.gameCode || '';
      this.playerName = state.playerName || '';
      this.players = state.players || [];
      this.phase = state.phase || 'idle';
      this.currentPlayerIndex = state.currentPlayerIndex || 0;
      this.hostId = state.hostId || '';
      this.movesMade = state.movesMade || 0;
      this.winner = state.winner || null;
      
      console.log(`[NostrMultiplayer] Loaded saved game: ${this.gameCode}`);
      return this.gameCode !== '';
    } catch (e) {
      console.error('[NostrMultiplayer] Failed to load state:', e);
      return false;
    }
  }
  
  // Event subscription
  onEvent(callback: (type: NostrEventType, data: any, senderId: string) => void) {
    this.eventCallbacks.push(callback);
  }
  
  onStateChange(callback: () => void) {
    this.stateCallbacks.push(callback);
  }
  
  private notifyStateChange() {
    this.stateCallbacks.forEach(cb => cb());
  }
  
  // Getters
  getMyId(): string {
    return this.identity.pubkey;
  }
  
  getGameCode(): string {
    return this.gameCode;
  }
  
  getPlayers(): NostrPlayer[] {
    return [...this.players];
  }
  
  getPhase(): 'idle' | 'lobby' | 'playing' | 'finished' {
    return this.phase;
  }
  
  getCurrentPlayer(): NostrPlayer | null {
    return this.players[this.currentPlayerIndex] || null;
  }
  
  getCurrentPlayerIndex(): number {
    return this.currentPlayerIndex;
  }
  
  getMyPlayer(): NostrPlayer | null {
    return this.players.find(p => p.id === this.identity.pubkey) || null;
  }
  
  getMyPlayerNumber(): number {
    return this.getMyPlayer()?.playerNumber || 0;
  }
  
  getPlayerName(): string {
    return this.playerName;
  }
  
  getMovesMade(): number {
    return this.movesMade;
  }
  
  getWinner(): number | null {
    return this.winner;
  }
  
  isHost(): boolean {
    return this.identity.pubkey === this.hostId;
  }
  
  isMyTurn(): boolean {
    const current = this.getCurrentPlayer();
    return current?.id === this.identity.pubkey;
  }
  
  isInGame(): boolean {
    return this.phase !== 'idle';
  }
  
  isPlaying(): boolean {
    return this.phase === 'playing';
  }
  
  isLobby(): boolean {
    return this.phase === 'lobby';
  }
  
  getShareUrl(): string {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?join=${this.gameCode}`;
  }
  
  // Check URL for join code
  getJoinCodeFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('join');
  }
  
  // Clear URL params
  clearUrlParams() {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url.toString());
  }
  
  getConnectedRelayCount(): number {
    return this.relays.filter(r => r.isConnected()).length;
  }
  
  disconnect() {
    this.relays.forEach(r => r.disconnect());
    this.relays = [];
  }
}

// Singleton instance
let instance: NostrMultiplayer | null = null;

export function getNostrMultiplayer(): NostrMultiplayer {
  if (!instance) {
    instance = new NostrMultiplayer();
  }
  return instance;
}
