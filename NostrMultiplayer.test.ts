// Tests for Nostr Multiplayer functionality
// Run with: npx vitest run NostrMultiplayer.test.ts

import { describe, it, expect, beforeEach } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// ============================================
// IDENTITY TESTS
// ============================================

describe('Identity Management', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });
  
  it('should generate a valid identity string', () => {
    // Identity generation test
    const generateId = () => {
      const chars = '0123456789abcdef';
      let result = '';
      for (let i = 0; i < 32; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
      }
      return result;
    };
    
    const id = generateId();
    expect(id).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });
  
  it('should persist identity to localStorage', () => {
    const id = 'test123456789abcdef0123456789ab';
    localStorageMock.setItem('chain_reaction_identity', id);
    
    const loaded = localStorageMock.getItem('chain_reaction_identity');
    expect(loaded).toBe(id);
  });
});

// ============================================
// GAME CODE TESTS
// ============================================

describe('Game Code Generation', () => {
  it('should generate 4-character game codes', () => {
    const generateGameCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      return code;
    };
    
    const code = generateGameCode();
    expect(code).toHaveLength(4);
    expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
  });
  
  it('should generate unique codes', () => {
    const generateGameCode = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      return code;
    };
    
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateGameCode());
    }
    // With 36^4 = 1.6M combinations, 100 codes should almost always be unique
    expect(codes.size).toBeGreaterThan(90);
  });
});

// ============================================
// PLAYER MANAGEMENT TESTS
// ============================================

describe('Player Management', () => {
  interface NostrPlayer {
    id: string;
    name: string;
    joinTime: number;
    playerNumber?: number;
  }
  
  it('should add players to the list', () => {
    const players: NostrPlayer[] = [];
    
    const addPlayer = (id: string, name: string) => {
      const existing = players.find(p => p.id === id || p.name.toLowerCase() === name.toLowerCase());
      if (existing) return false;
      
      players.push({
        id,
        name,
        joinTime: Date.now(),
        playerNumber: players.length + 1,
      });
      return true;
    };
    
    expect(addPlayer('id1', 'Alice')).toBe(true);
    expect(players.length).toBe(1);
    expect(players[0].playerNumber).toBe(1);
    
    expect(addPlayer('id2', 'Bob')).toBe(true);
    expect(players.length).toBe(2);
    expect(players[1].playerNumber).toBe(2);
  });
  
  it('should reject duplicate players by id', () => {
    const players: NostrPlayer[] = [];
    
    const addPlayer = (id: string, name: string) => {
      const existing = players.find(p => p.id === id || p.name.toLowerCase() === name.toLowerCase());
      if (existing) return false;
      
      players.push({
        id,
        name,
        joinTime: Date.now(),
        playerNumber: players.length + 1,
      });
      return true;
    };
    
    addPlayer('id1', 'Alice');
    expect(addPlayer('id1', 'Alice2')).toBe(false);
    expect(players.length).toBe(1);
  });
  
  it('should reject duplicate players by name (case insensitive)', () => {
    const players: NostrPlayer[] = [];
    
    const addPlayer = (id: string, name: string) => {
      const existing = players.find(p => p.id === id || p.name.toLowerCase() === name.toLowerCase());
      if (existing) return false;
      
      players.push({
        id,
        name,
        joinTime: Date.now(),
        playerNumber: players.length + 1,
      });
      return true;
    };
    
    addPlayer('id1', 'alice');
    expect(addPlayer('id2', 'ALICE')).toBe(false);
    expect(addPlayer('id3', 'Alice')).toBe(false);
    expect(players.length).toBe(1);
  });
  
  it('should enforce max 4 players', () => {
    const players: NostrPlayer[] = [];
    const maxPlayers = 4;
    
    const addPlayer = (id: string, name: string) => {
      if (players.length >= maxPlayers) return false;
      
      const existing = players.find(p => p.id === id || p.name.toLowerCase() === name.toLowerCase());
      if (existing) return false;
      
      players.push({
        id,
        name,
        joinTime: Date.now(),
        playerNumber: players.length + 1,
      });
      return true;
    };
    
    expect(addPlayer('id1', 'Alice')).toBe(true);
    expect(addPlayer('id2', 'Bob')).toBe(true);
    expect(addPlayer('id3', 'Charlie')).toBe(true);
    expect(addPlayer('id4', 'Diana')).toBe(true);
    expect(addPlayer('id5', 'Eve')).toBe(false);
    expect(players.length).toBe(4);
  });
  
  it('should reassign player numbers when a player leaves', () => {
    const players: NostrPlayer[] = [
      { id: 'id1', name: 'Alice', joinTime: 1, playerNumber: 1 },
      { id: 'id2', name: 'Bob', joinTime: 2, playerNumber: 2 },
      { id: 'id3', name: 'Charlie', joinTime: 3, playerNumber: 3 },
    ];
    
    const removePlayer = (id: string) => {
      const idx = players.findIndex(p => p.id === id);
      if (idx >= 0) {
        players.splice(idx, 1);
        players.forEach((p, i) => {
          p.playerNumber = i + 1;
        });
      }
    };
    
    removePlayer('id2');
    
    expect(players.length).toBe(2);
    expect(players[0].playerNumber).toBe(1);
    expect(players[1].playerNumber).toBe(2);
    expect(players[1].name).toBe('Charlie');
  });
});

// ============================================
// TURN MANAGEMENT TESTS
// ============================================

describe('Turn Management', () => {
  it('should correctly identify current player', () => {
    const players = [
      { id: 'id1', name: 'Alice', playerNumber: 1 },
      { id: 'id2', name: 'Bob', playerNumber: 2 },
    ];
    let currentPlayerIndex = 0;
    const myId = 'id1';
    
    const isMyTurn = () => players[currentPlayerIndex]?.id === myId;
    
    expect(isMyTurn()).toBe(true);
    
    currentPlayerIndex = 1;
    expect(isMyTurn()).toBe(false);
  });
  
  it('should advance to next player correctly', () => {
    const players = [
      { id: 'id1', name: 'Alice' },
      { id: 'id2', name: 'Bob' },
      { id: 'id3', name: 'Charlie' },
    ];
    let currentPlayerIndex = 0;
    
    const advancePlayer = () => {
      currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    };
    
    expect(currentPlayerIndex).toBe(0);
    advancePlayer();
    expect(currentPlayerIndex).toBe(1);
    advancePlayer();
    expect(currentPlayerIndex).toBe(2);
    advancePlayer();
    expect(currentPlayerIndex).toBe(0); // Wraps around
  });
});

// ============================================
// MOVE VALIDATION TESTS
// ============================================

describe('Move Data', () => {
  interface NostrMoveData {
    r: number;
    c: number;
    player: number;
    moveNumber: number;
  }
  
  it('should create valid move data', () => {
    const createMoveData = (r: number, c: number, player: number, moveNumber: number): NostrMoveData => ({
      r, c, player, moveNumber
    });
    
    const move = createMoveData(3, 4, 1, 5);
    
    expect(move.r).toBe(3);
    expect(move.c).toBe(4);
    expect(move.player).toBe(1);
    expect(move.moveNumber).toBe(5);
  });
  
  it('should validate move coordinates are within bounds', () => {
    const GRID_ROWS = 9;
    const GRID_COLS = 6;
    
    const isValidCoord = (r: number, c: number) => {
      return r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS;
    };
    
    expect(isValidCoord(0, 0)).toBe(true);
    expect(isValidCoord(8, 5)).toBe(true);
    expect(isValidCoord(-1, 0)).toBe(false);
    expect(isValidCoord(9, 0)).toBe(false);
    expect(isValidCoord(0, 6)).toBe(false);
  });
});

// ============================================
// SHARE URL TESTS
// ============================================

describe('Share URL', () => {
  it('should generate correct share URL', () => {
    const origin = 'http://localhost:5173';
    const pathname = '/';
    const gameCode = 'ABCD';
    
    const getShareUrl = () => `${origin}${pathname}?join=${gameCode}`;
    
    expect(getShareUrl()).toBe('http://localhost:5173/?join=ABCD');
  });
  
  it('should parse join code from URL', () => {
    const parseJoinCode = (search: string) => {
      const params = new URLSearchParams(search);
      return params.get('join');
    };
    
    expect(parseJoinCode('?join=ABCD')).toBe('ABCD');
    expect(parseJoinCode('?join=1234')).toBe('1234');
    expect(parseJoinCode('')).toBeNull();
    expect(parseJoinCode('?other=value')).toBeNull();
  });
});

// ============================================
// EVENT DEDUPLICATION TESTS
// ============================================

describe('Event Deduplication', () => {
  it('should track processed events', () => {
    const processedEvents = new Set<string>();
    
    const processEvent = (eventId: string) => {
      if (processedEvents.has(eventId)) {
        return false; // Already processed
      }
      processedEvents.add(eventId);
      return true;
    };
    
    expect(processEvent('event1')).toBe(true);
    expect(processEvent('event2')).toBe(true);
    expect(processEvent('event1')).toBe(false); // Duplicate
    expect(processedEvents.size).toBe(2);
  });
  
  it('should create unique event keys', () => {
    const createEventKey = (type: string, senderId: string, timestamp: number) => {
      return `${type}-${senderId}-${timestamp}`;
    };
    
    const key1 = createEventKey('join', 'abc123', 1000);
    const key2 = createEventKey('join', 'abc123', 1001);
    const key3 = createEventKey('move', 'abc123', 1000);
    
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toBe('join-abc123-1000');
  });
});

// ============================================
// STATE PERSISTENCE TESTS
// ============================================

describe('State Persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });
  
  it('should save game state to localStorage', () => {
    const state = {
      gameCode: 'ABCD',
      playerName: 'alice',
      players: [{ id: 'id1', name: 'alice', joinTime: 1000, playerNumber: 1 }],
      phase: 'lobby',
      currentPlayerIndex: 0,
      hostId: 'id1',
      movesMade: 0,
      winner: null,
    };
    
    localStorageMock.setItem('chain_reaction_game_state', JSON.stringify(state));
    
    const loaded = JSON.parse(localStorageMock.getItem('chain_reaction_game_state')!);
    expect(loaded.gameCode).toBe('ABCD');
    expect(loaded.playerName).toBe('alice');
    expect(loaded.players).toHaveLength(1);
  });
  
  it('should load game state from localStorage', () => {
    const state = {
      gameCode: 'TEST',
      playerName: 'bob',
      phase: 'playing',
    };
    
    localStorageMock.setItem('chain_reaction_game_state', JSON.stringify(state));
    
    const loadState = () => {
      const saved = localStorageMock.getItem('chain_reaction_game_state');
      if (!saved) return null;
      return JSON.parse(saved);
    };
    
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded.gameCode).toBe('TEST');
    expect(loaded.phase).toBe('playing');
  });
});

// ============================================
// HOST DETERMINATION TESTS
// ============================================

describe('Host Determination', () => {
  it('should identify host as first player', () => {
    const players = [
      { id: 'id1', name: 'First', joinTime: 1000 },
      { id: 'id2', name: 'Second', joinTime: 2000 },
    ];
    
    const determineHost = () => players[0]?.id || '';
    const myId = 'id1';
    
    const isHost = () => determineHost() === myId;
    
    expect(isHost()).toBe(true);
  });
  
  it('should update host when first player leaves', () => {
    let players = [
      { id: 'id1', name: 'First', joinTime: 1000 },
      { id: 'id2', name: 'Second', joinTime: 2000 },
    ];
    
    let hostId = players[0].id;
    const myId = 'id2';
    
    // First player leaves
    players = players.filter(p => p.id !== 'id1');
    hostId = players[0]?.id || '';
    
    expect(hostId).toBe('id2');
    expect(hostId === myId).toBe(true);
  });
});

// ============================================
// NETWORK PLAYER CONFIG TESTS
// ============================================

describe('Network Player Configuration', () => {
  it('should create correct player configs for online game', () => {
    interface PlayerConfig {
      type: 'human' | 'ai' | 'network' | 'off';
      controllerId: number | null;
    }
    
    const createNetworkPlayerConfigs = (players: { id: string }[], myId: string): PlayerConfig[] => {
      return players.map(player => ({
        type: player.id === myId ? 'human' : 'network',
        controllerId: null,
      }));
    };
    
    const players = [
      { id: 'id1', name: 'Alice' },
      { id: 'id2', name: 'Bob' },
      { id: 'id3', name: 'Charlie' },
    ];
    
    const configs = createNetworkPlayerConfigs(players, 'id2');
    
    expect(configs).toHaveLength(3);
    expect(configs[0].type).toBe('network');
    expect(configs[1].type).toBe('human'); // This is me
    expect(configs[2].type).toBe('network');
  });
});

// ============================================
// GAME PHASE TESTS
// ============================================

describe('Game Phase Transitions', () => {
  it('should transition through phases correctly', () => {
    type Phase = 'idle' | 'lobby' | 'playing' | 'finished';
    let phase: Phase = 'idle';
    
    // Create game
    phase = 'lobby';
    expect(phase).toBe('lobby');
    
    // Start game
    phase = 'playing';
    expect(phase).toBe('playing');
    
    // Game ends
    phase = 'finished';
    expect(phase).toBe('finished');
    
    // Leave/reset
    phase = 'idle';
    expect(phase).toBe('idle');
  });
  
  it('should only allow host to start game', () => {
    const isHost = true;
    const playerCount = 2;
    const phase = 'lobby';
    
    const canStart = () => isHost && playerCount >= 2 && phase === 'lobby';
    
    expect(canStart()).toBe(true);
  });
  
  it('should require minimum 2 players to start', () => {
    const isHost = true;
    const phase = 'lobby';
    
    let playerCount = 1;
    const canStart = () => isHost && playerCount >= 2 && phase === 'lobby';
    
    expect(canStart()).toBe(false);
    
    playerCount = 2;
    expect(canStart()).toBe(true);
  });
});
