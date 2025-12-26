import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameState,
  PlayerConfig,
  PlayerType,
  GRID_ROWS,
  GRID_COLS,
  PLAYER_COLORS,
  PLAYER_NAMES,
  CELL_COLORS,
  createGrid,
  getCell,
  validateMove,
  getNeighborCoords,
  checkWinner,
  getNextPlayer,
  aiFindBestMove,
} from './engine';
import {
  useGamepads,
  useGamepadButtons,
  useGamepadNavigation,
  GAMEPAD_BUTTONS,
} from './useGamepads';
import {
  NostrMultiplayer,
  getNostrMultiplayer,
  NostrPlayer,
  NostrEventType,
  NostrMoveData,
} from './NostrMultiplayer';

// Game mode types
type GameMode = 'menu' | 'local' | 'online-lobby' | 'online-game' | 'join-prompt';

// Audio context for sound effects
let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

function playSound(type: 'place' | 'pop' | 'win' | 'join') {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;

  if (type === 'place') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'join') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  } else if (type === 'pop') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'win') {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.setValueAtTime(freq, now + i * 0.15);
      g.gain.setValueAtTime(0.1, now + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.3);
      o.start(now + i * 0.15);
      o.stop(now + i * 0.15 + 0.3);
    });
  }
}

// Particle system types
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  size: number;
}

interface FlyingOrb {
  startR: number;
  startC: number;
  endR: number;
  endC: number;
  color: string;
  glowColor: string;
  progress: number;
  trail: { x: number; y: number; life: number }[];
}

interface Shockwave {
  x: number;
  y: number;
  color: string;
  radius: number;
  maxRadius: number;
  life: number;
}

// Default player configs
function getDefaultPlayerConfigs(): PlayerConfig[] {
  return [
    { type: 'human', controllerId: null },
    { type: 'ai', controllerId: null },
    { type: 'off', controllerId: null },
    { type: 'off', controllerId: null },
  ];
}

// Create network player configs based on Nostr players
function createNetworkPlayerConfigs(players: NostrPlayer[], myId: string): PlayerConfig[] {
  return players.map(player => ({
    type: player.id === myId ? 'human' : 'network' as PlayerType,
    controllerId: null,
  }));
}

export function ChainReactionApp() {
  // Game mode state
  const [gameMode, setGameMode] = useState<GameMode>('menu');
  
  // Menu state (for local game)
  const [showMenu, setShowMenu] = useState(true);
  const [menuMode, setMenuMode] = useState<'local' | 'online'>('local');
  const [playerConfigs, setPlayerConfigs] = useState<PlayerConfig[]>(getDefaultPlayerConfigs);
  
  // Online multiplayer state
  const [nostrMultiplayer] = useState<NostrMultiplayer>(() => getNostrMultiplayer());
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [onlinePlayers, setOnlinePlayers] = useState<NostrPlayer[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [relayCount, setRelayCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null); // For URL join flow
  
  // Game state
  const [gameState, setGameState] = useState<GameState | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const myPlayerNumber = nostrMultiplayer.getMyPlayerNumber();
  
  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  
  // Animation state
  const [isAnimating, setIsAnimating] = useState(false);
  const particlesRef = useRef<Particle[]>([]);
  const flyingOrbsRef = useRef<FlyingOrb[]>([]);
  const shockwavesRef = useRef<Shockwave[]>([]);
  const explosionQueueRef = useRef<{ r: number; c: number }[]>([]);
  const explosionCountRef = useRef(0); // Track explosion count to prevent infinite loops
  const MAX_EXPLOSIONS_PER_TURN = 500; // Safety limit
  
  // Debounce ref for network moves to prevent double-sends
  const lastMoveTimeRef = useRef<number>(0);
  const MOVE_DEBOUNCE_MS = 300;
  
  // Track last executed move to prevent double execution
  const lastExecutedMoveRef = useRef<string>('');
  
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 300, height: 450 });
  
  // Calculate cell dimensions (used by multiple functions)
  const cellWidth = dimensions.width / GRID_COLS;
  const cellHeight = dimensions.height / GRID_ROWS;
  
  // Cursor position for gamepad
  const [cursorPos, setCursorPos] = useState({ r: 0, c: 0 });
  
  // Gamepad support
  const { gamepads } = useGamepads();

  // Initialize multiplayer and check for URL join code
  useEffect(() => {
    const init = async () => {
      console.log('[App] Initializing multiplayer...');
      
      // Load saved player name
      const savedName = localStorage.getItem('chain_reaction_player_name');
      if (savedName) {
        setPlayerName(savedName);
        console.log('[App] Loaded saved player name:', savedName);
      }
      
      // Connect to relays
      const connected = await nostrMultiplayer.connect();
      setRelayCount(connected);
      console.log('[App] Connected to', connected, 'relays');
      
      // Check for join code in URL
      const urlJoinCode = nostrMultiplayer.getJoinCodeFromUrl();
      if (urlJoinCode) {
        console.log('[App] Found join code in URL:', urlJoinCode);
        setJoinCode(urlJoinCode);
        setPendingJoinCode(urlJoinCode);
        nostrMultiplayer.clearUrlParams();
        
        // If we have a saved name, auto-join immediately
        if (savedName) {
          console.log('[App] Auto-joining game with saved name:', savedName);
          setIsConnecting(true);
          try {
            await nostrMultiplayer.joinGame(urlJoinCode, savedName);
            console.log('[App] Successfully joined game');
            setOnlinePlayers([...nostrMultiplayer.getPlayers()]);
            setIsHost(nostrMultiplayer.isHost());
            setGameMode('online-lobby');
            setPendingJoinCode(null);
          } catch (e) {
            console.error('[App] Failed to auto-join:', e);
          }
          setIsConnecting(false);
        } else {
          // No saved name - show join prompt
          setGameMode('join-prompt');
        }
      }
      
      // Set up event handlers
      nostrMultiplayer.onStateChange(() => {
        console.log('[App] Nostr state changed');
        setOnlinePlayers([...nostrMultiplayer.getPlayers()]);
        setIsHost(nostrMultiplayer.isHost());
        
        // Check if game started
        if (nostrMultiplayer.isPlaying() && (gameMode === 'online-lobby' || gameMode === 'join-prompt')) {
          console.log('[App] Game started! Transitioning to online game');
          startOnlineGame();
        }
      });
      
      nostrMultiplayer.onEvent((type, data, senderId) => {
        console.log('[App] Received event:', type, data);
        handleNostrEvent(type, data, senderId);
      });
    };
    
    init();
    
    return () => {
      // Cleanup on unmount
    };
  }, []);

  // Start online game - called both when host starts and when joiners receive start event
  const startOnlineGame = useCallback(() => {
    const players = nostrMultiplayer.getPlayers();
    console.log('[App] Starting online game with', players.length, 'players');
    
    const activePlayers = players.map(p => p.playerNumber || 1);
    const configs = createNetworkPlayerConfigs(players, nostrMultiplayer.getMyId());
    
    setGameState({
      grid: createGrid(),
      currentPlayer: activePlayers[0],
      movesMade: 0,
      gameActive: true,
      winner: null,
      playerConfigs: configs,
      activePlayers,
    });
    
    setPlayerConfigs(configs);
    setCursorPos({ r: Math.floor(GRID_ROWS / 2), c: Math.floor(GRID_COLS / 2) });
    setGameMode('online-game');
    setShowMenu(false);
  }, []);

  // Handle Nostr events - uses refs to avoid stale closure issues
  const handleNostrEvent = useCallback((type: NostrEventType, data: any, senderId: string) => {
    console.log('[App] Processing Nostr event:', type);
    
    if (type === 'join') {
      playSound('join');
    } else if (type === 'start') {
      console.log('[App] Game start event received - starting game for this client');
      // Start the game on this client when we receive the start event
      startOnlineGame();
    } else if (type === 'move') {
      const moveData = data as NostrMoveData;
      console.log('[App] Remote move received:', moveData);
      
      // Check for duplicate move using ref (prevents double execution)
      const moveKey = `${moveData.r}-${moveData.c}-${moveData.moveNumber}`;
      if (lastExecutedMoveRef.current === moveKey) {
        console.log('[App] Skipping duplicate move:', moveKey);
        return;
      }
      lastExecutedMoveRef.current = moveKey;
      
      // Use ref to check current game state (avoids stale closure)
      const currentGameState = gameStateRef.current;
      if (!currentGameState) {
        console.log('[App] No game state yet, queuing move for retry...');
        // Retry after a short delay to allow game state to be set
        setTimeout(() => {
          console.log('[App] Retrying remote move execution...');
          executeRemoteMove(moveData.r, moveData.c, moveData.player);
        }, 500);
        return;
      }
      
      // Execute the remote move
      executeRemoteMove(moveData.r, moveData.c, moveData.player);
    }
  }, [startOnlineGame]);

  // Execute a remote player's move (no validation needed - trust network)
  const executeRemoteMove = useCallback((r: number, c: number, player: number) => {
    // Use ref to check current game state (avoids stale closure)
    const currentGameState = gameStateRef.current;
    if (!currentGameState || !currentGameState.gameActive || currentGameState.winner) {
      console.log('[App] Cannot execute remote move - game not active, state:', currentGameState);
      return;
    }
    
    console.log('[App] Executing remote move:', r, c, 'player', player);
    
    setGameState(prev => {
      if (!prev) return prev;
      
      const newGrid = prev.grid.map(cell => ({ ...cell }));
      const cell = getCell(newGrid, r, c);
      if (!cell) return prev;
      
      cell.owner = player;
      cell.orbs++;
      
      playSound('place');
      
      // Add placement particles
      const cx = c * cellWidth + cellWidth / 2;
      const cy = r * cellHeight + cellHeight / 2;
      const color = PLAYER_COLORS[player as keyof typeof PLAYER_COLORS]?.primary || '#fff';
      
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 2;
        particlesRef.current.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          life: 1.0,
          size: 2,
        });
      }
      
      // Check for explosion
      if (cell.orbs > cell.capacity) {
        explosionQueueRef.current.push({ r, c });
        setIsAnimating(true);
        return {
          ...prev,
          grid: newGrid,
        };
      }
      
      // No explosion - switch turn immediately
      const newMovesMade = prev.movesMade + 1;
      const winner = checkWinner(newGrid, prev.activePlayers, newMovesMade);
      if (winner) {
        playSound('win');
        nostrMultiplayer.setWinner(winner);
        return { ...prev, grid: newGrid, movesMade: newMovesMade, winner, gameActive: false };
      }
      
      const nextPlayer = getNextPlayer(prev.currentPlayer, prev.activePlayers, newGrid, newMovesMade);
      nostrMultiplayer.advancePlayer();
      console.log('[App] Remote move - switching from player', prev.currentPlayer, 'to', nextPlayer);
      return {
        ...prev,
        grid: newGrid,
        movesMade: newMovesMade,
        currentPlayer: nextPlayer,
      };
    });
  }, [gameState, cellWidth, cellHeight]);

  // Create online game
  const handleCreateGame = async () => {
    if (!playerName.trim()) {
      console.log('[App] Player name required');
      return;
    }
    
    setIsConnecting(true);
    console.log('[App] Creating online game as', playerName);
    
    localStorage.setItem('chain_reaction_player_name', playerName.trim());
    
    const code = await nostrMultiplayer.createGame(playerName.trim());
    console.log('[App] Game created with code:', code);
    
    setOnlinePlayers([...nostrMultiplayer.getPlayers()]);
    setIsHost(true);
    setGameMode('online-lobby');
    setIsConnecting(false);
  };

  // Join online game
  const handleJoinGame = async () => {
    if (!playerName.trim()) {
      console.log('[App] Player name required');
      return;
    }
    
    const codeToJoin = joinCode.trim() || pendingJoinCode;
    if (!codeToJoin) {
      console.log('[App] Game code required');
      return;
    }
    
    setIsConnecting(true);
    console.log('[App] Joining game', codeToJoin, 'as', playerName);
    
    localStorage.setItem('chain_reaction_player_name', playerName.trim());
    
    await nostrMultiplayer.joinGame(codeToJoin, playerName.trim());
    console.log('[App] Joined game');
    
    setOnlinePlayers([...nostrMultiplayer.getPlayers()]);
    setIsHost(nostrMultiplayer.isHost());
    setGameMode('online-lobby');
    setPendingJoinCode(null);
    setIsConnecting(false);
  };

  // Start online game (host only)
  const handleStartOnlineGame = async () => {
    if (!isHost) {
      console.log('[App] Only host can start');
      return;
    }
    
    if (onlinePlayers.length < 2) {
      console.log('[App] Need at least 2 players');
      return;
    }
    
    console.log('[App] Host starting game...');
    await nostrMultiplayer.startGame();
    startOnlineGame();
  };

  // Leave online game
  const handleLeaveGame = async () => {
    console.log('[App] Leaving game');
    await nostrMultiplayer.leaveGame();
    setGameMode('menu');
    setOnlinePlayers([]);
    setIsHost(false);
    setJoinCode('');
    setGameState(null);
    setShowMenu(true);
    setMenuMode('online'); // Return to online tab so user can rejoin/create
  };

  // Copy share link
  const copyShareLink = () => {
    const url = nostrMultiplayer.getShareUrl();
    navigator.clipboard.writeText(url);
    setCopied(true);
    console.log('[App] Copied share link:', url);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get active player's gamepad (for the current turn)
  const currentPlayerConfig = gameState 
    ? gameState.playerConfigs[gameState.currentPlayer - 1] 
    : null;
  const currentGamepad = (currentPlayerConfig && currentPlayerConfig.controllerId != null)
    ? gamepads.find(gp => gp.index === currentPlayerConfig.controllerId) 
    : undefined;

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      
      const maxWidth = containerRef.current.clientWidth - 40;
      const maxHeight = containerRef.current.clientHeight - 120;
      
      let w = maxWidth;
      let h = w * (GRID_ROWS / GRID_COLS);
      
      if (h > maxHeight) {
        h = maxHeight;
        w = h * (GRID_COLS / GRID_ROWS);
      }
      
      setDimensions({ width: w, height: h });
    };
    
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [showMenu]);

  // Toggle player type
  const cyclePlayerType = (index: number) => {
    setPlayerConfigs(prev => {
      const next = [...prev];
      const current = next[index].type;
      let newType: PlayerType;
      
      if (current === 'off') newType = 'human';
      else if (current === 'human') newType = 'ai';
      else newType = 'off';
      
      // At least 2 players must be active
      const activeCount = next.filter((p, i) => i === index ? newType !== 'off' : p.type !== 'off').length;
      if (activeCount < 2 && newType === 'off') {
        newType = 'human';
      }
      
      next[index] = { ...next[index], type: newType };
      return next;
    });
  };

  // Assign controller to player
  const assignController = (playerIndex: number, controllerId: number | null) => {
    setPlayerConfigs(prev => {
      const next = [...prev];
      // Remove this controller from any other player
      next.forEach((p, i) => {
        if (p.controllerId === controllerId && i !== playerIndex) {
          next[i] = { ...p, controllerId: null };
        }
      });
      next[playerIndex] = { ...next[playerIndex], controllerId };
      return next;
    });
  };

  // Start game
  const startGame = () => {
    const activePlayers = playerConfigs
      .map((p, i) => p.type !== 'off' ? i + 1 : 0)
      .filter(p => p > 0);
    
    if (activePlayers.length < 2) return;
    
    setGameState({
      grid: createGrid(),
      currentPlayer: activePlayers[0],
      movesMade: 0,
      gameActive: true,
      winner: null,
      playerConfigs: [...playerConfigs],
      activePlayers,
    });
    
    setCursorPos({ r: Math.floor(GRID_ROWS / 2), c: Math.floor(GRID_COLS / 2) });
    setShowMenu(false);
  };

  // Restart game
  const restartGame = () => {
    if (!gameState) return;
    
    setGameState({
      ...gameState,
      grid: createGrid(),
      currentPlayer: gameState.activePlayers[0],
      movesMade: 0,
      gameActive: true,
      winner: null,
    });
    
    particlesRef.current = [];
    flyingOrbsRef.current = [];
    shockwavesRef.current = [];
    explosionQueueRef.current = [];
    setIsAnimating(false);
  };

  // Execute a move
  const executeMove = useCallback((r: number, c: number, player: number, isNetworkMove = false) => {
    if (!gameState || !gameState.gameActive || gameState.winner) return;
    if (!validateMove(gameState.grid, r, c, player)) return;
    
    // Prevent double execution of the same move using ref
    const moveKey = `${r}-${c}-${gameState.movesMade + 1}-${isNetworkMove ? 'net' : 'local'}`;
    if (lastExecutedMoveRef.current === moveKey) {
      console.log('[App] Skipping duplicate executeMove:', moveKey);
      return;
    }
    lastExecutedMoveRef.current = moveKey;
    
    // For online games, publish the move to network (unless it's a network move we received)
    if (gameMode === 'online-game' && !isNetworkMove) {
      console.log('[App] Publishing local move to network:', r, c, player);
      // Turn gating is handled in-app via gameState/currentPlayer.
      // NostrMultiplayer's internal currentPlayerIndex can drift if a relay drops/replays history.
      nostrMultiplayer.makeMove(r, c, { skipTurnCheck: true });
    }
    
    setGameState(prev => {
      if (!prev) return prev;
      
      const newGrid = prev.grid.map(cell => ({ ...cell }));
      const cell = getCell(newGrid, r, c);
      if (!cell) return prev;
      
      cell.owner = player;
      cell.orbs++;
      
      playSound('place');
      
      // Add placement particles
      const cx = c * cellWidth + cellWidth / 2;
      const cy = r * cellHeight + cellHeight / 2;
      const color = PLAYER_COLORS[player as keyof typeof PLAYER_COLORS]?.primary || '#fff';
      
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 2;
        particlesRef.current.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          life: 1.0,
          size: 2,
        });
      }
      
      // Check for explosion
      if (cell.orbs > cell.capacity) {
        explosionQueueRef.current.push({ r, c });
        setIsAnimating(true);
        // Don't switch turn yet - wait for explosion chain to finish
        return {
          ...prev,
          grid: newGrid,
        };
      }
      
      // No explosion - switch turn immediately
      const newMovesMade = prev.movesMade + 1;
      const winner = checkWinner(newGrid, prev.activePlayers, newMovesMade);
      if (winner) {
        playSound('win');
        if (gameMode === 'online-game') {
          nostrMultiplayer.setWinner(winner);
        }
        return { ...prev, grid: newGrid, movesMade: newMovesMade, winner, gameActive: false };
      }
      
      const nextPlayer = getNextPlayer(prev.currentPlayer, prev.activePlayers, newGrid, newMovesMade);
      if (gameMode === 'online-game') {
        nostrMultiplayer.advancePlayer();
      }
      console.log('[Turn] No explosion - switching from player', prev.currentPlayer, 'to', nextPlayer);
      return {
        ...prev,
        grid: newGrid,
        movesMade: newMovesMade,
        currentPlayer: nextPlayer,
      };
    });
  }, [gameState, cellWidth, cellHeight, gameMode]);

  // Process explosions
  useEffect(() => {
    if (!isAnimating || !gameState) return;
    
    const processExplosion = () => {
      if (flyingOrbsRef.current.length > 0) return; // Wait for orbs to land
      
      // Safety check: too many explosions (infinite loop protection)
      if (explosionCountRef.current >= MAX_EXPLOSIONS_PER_TURN) {
        console.warn('[Explosion] Hit max explosion limit - possible infinite loop, ending chain');
        explosionQueueRef.current = [];
        explosionCountRef.current = 0;
        setIsAnimating(false);
        return;
      }
      
      if (explosionQueueRef.current.length === 0) {
        // End of chain reaction
        explosionCountRef.current = 0; // Reset counter for next turn
        setIsAnimating(false);
        
        // End turn
        setGameState(prev => {
          if (!prev || prev.winner) return prev; // Already have winner
          
          const newMovesMade = prev.movesMade + 1;
          
          // Check for winner
          const winner = checkWinner(prev.grid, prev.activePlayers, newMovesMade);
          if (winner) {
            console.log('[Explosion End] Winner detected:', winner);
            playSound('win');
            if (gameMode === 'online-game') {
              nostrMultiplayer.setWinner(winner);
            }
            return { ...prev, movesMade: newMovesMade, winner, gameActive: false };
          }
          
          // Double-check alive players
          const alive = prev.grid.filter(c => c.orbs > 0);
          const aliveOwners = new Set(alive.map(c => c.owner));
          const alivePlayers = prev.activePlayers.filter(p => aliveOwners.has(p));
          
          if (alivePlayers.length <= 1 && newMovesMade >= prev.activePlayers.length) {
            const finalWinner = alivePlayers[0] || prev.currentPlayer;
            console.log('[Explosion End] Only', alivePlayers.length, 'alive - winner:', finalWinner);
            playSound('win');
            if (gameMode === 'online-game') {
              nostrMultiplayer.setWinner(finalWinner);
            }
            return { ...prev, movesMade: newMovesMade, winner: finalWinner, gameActive: false };
          }
          
          const nextPlayer = getNextPlayer(prev.currentPlayer, prev.activePlayers, prev.grid, newMovesMade);
          
          // Safety check: if next player is same as current, we might be in a loop
          if (nextPlayer === prev.currentPlayer && alivePlayers.length <= 1) {
            console.log('[Explosion End] Loop detected - declaring winner:', prev.currentPlayer);
            playSound('win');
            if (gameMode === 'online-game') {
              nostrMultiplayer.setWinner(prev.currentPlayer);
            }
            return { ...prev, movesMade: newMovesMade, winner: prev.currentPlayer, gameActive: false };
          }
          
          if (gameMode === 'online-game') {
            nostrMultiplayer.advancePlayer();
          }
          console.log('[Turn] Switching from player', prev.currentPlayer, 'to', nextPlayer, 'movesMade:', newMovesMade);
          return { ...prev, movesMade: newMovesMade, currentPlayer: nextPlayer };
        });
        return;
      }
      
      const { r, c } = explosionQueueRef.current.shift()!;
      explosionCountRef.current++; // Track explosion count
      
      setGameState(prev => {
        if (!prev) return prev;
        
        const newGrid = prev.grid.map(cell => ({ ...cell }));
        const cell = getCell(newGrid, r, c);
        if (!cell || cell.orbs <= cell.capacity) return prev;
        
        playSound('pop');
        
        const color = PLAYER_COLORS[cell.owner as keyof typeof PLAYER_COLORS]?.primary || '#fff';
        const glowColor = PLAYER_COLORS[cell.owner as keyof typeof PLAYER_COLORS]?.glow || 'rgba(255,255,255,0.8)';
        const ownerPlayer = cell.owner;
        
        cell.orbs -= (cell.capacity + 1);
        if (cell.orbs === 0) cell.owner = 0;
        
        const cx = c * cellWidth + cellWidth / 2;
        const cy = r * cellHeight + cellHeight / 2;
        
        // Explosion particles
        for (let i = 0; i < 16; i++) {
          const angle = (Math.PI * 2 * i) / 16;
          particlesRef.current.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * 5,
            vy: Math.sin(angle) * 5,
            color,
            life: 1.0,
            size: 4,
          });
        }
        
        // Shockwave
        shockwavesRef.current.push({
          x: cx,
          y: cy,
          color,
          radius: 0,
          maxRadius: Math.max(cellWidth, cellHeight) * 0.8,
          life: 1.0,
        });
        
        // Flying orbs to neighbors
        const neighbors = getNeighborCoords(r, c);
        for (const [nr, nc] of neighbors) {
          flyingOrbsRef.current.push({
            startR: r,
            startC: c,
            endR: nr,
            endC: nc,
            color,
            glowColor,
            progress: 0,
            trail: [],
          });
          
          // Queue landing
          const targetCell = getCell(newGrid, nr, nc);
          if (targetCell) {
            targetCell.owner = ownerPlayer;
            targetCell.orbs++;
            
            if (targetCell.orbs > targetCell.capacity) {
              const alreadyQueued = explosionQueueRef.current.some(
                q => q.r === nr && q.c === nc
              );
              if (!alreadyQueued) {
                explosionQueueRef.current.push({ r: nr, c: nc });
              }
            }
          }
        }
        
        return { ...prev, grid: newGrid };
      });
    };
    
    const interval = setInterval(processExplosion, 120);
    return () => clearInterval(interval);
  }, [isAnimating, gameState, cellWidth, cellHeight]);

  // AI turn
  useEffect(() => {
    if (!gameState || !gameState.gameActive || isAnimating || gameState.winner) {
      return;
    }
    
    // Check if game should be over (only 1 player alive)
    const ownersWithOrbs = new Set(
      gameState.grid.filter(c => c.orbs > 0).map(c => c.owner)
    );
    const alivePlayers = gameState.activePlayers.filter(p => ownersWithOrbs.has(p));
    
    if (alivePlayers.length <= 1 && gameState.movesMade >= gameState.activePlayers.length) {
      // Game should end - declare winner
      const winner = alivePlayers[0] || gameState.currentPlayer;
      console.log('[AI] Game over - only', alivePlayers.length, 'player(s) alive. Winner:', winner);
      setGameState(prev => {
        if (!prev || prev.winner) return prev; // Already has winner
        return { ...prev, winner, gameActive: false };
      });
      return;
    }
    
    const config = gameState.playerConfigs[gameState.currentPlayer - 1];
    if (!config || config.type !== 'ai') return;
    
    // Make sure current player is alive (has orbs or can place on empty)
    const currentPlayerHasOrbs = ownersWithOrbs.has(gameState.currentPlayer);
    const hasValidMove = aiFindBestMove(gameState.grid, gameState.currentPlayer) !== null;
    
    if (!currentPlayerHasOrbs && !hasValidMove) {
      console.log('[AI] Player', gameState.currentPlayer, 'has no valid moves, skipping');
      // This player is eliminated, skip to next
      setGameState(prev => {
        if (!prev) return prev;
        const nextPlayer = getNextPlayer(prev.currentPlayer, prev.activePlayers, prev.grid, prev.movesMade);
        if (nextPlayer === prev.currentPlayer) {
          // Only one player left
          return { ...prev, winner: prev.currentPlayer, gameActive: false };
        }
        return { ...prev, currentPlayer: nextPlayer };
      });
      return;
    }
    
    console.log('[AI] Taking turn for player', gameState.currentPlayer);
    const timeout = setTimeout(() => {
      const move = aiFindBestMove(gameState.grid, gameState.currentPlayer);
      console.log('[AI] Best move:', move);
      if (move) {
        executeMove(move.r, move.c, gameState.currentPlayer);
      } else {
        console.log('[AI] No valid move found for player', gameState.currentPlayer);
      }
    }, 400 + Math.random() * 300);
    
    return () => clearTimeout(timeout);
  }, [gameState, isAnimating, executeMove]);

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!gameState || !gameState.gameActive || isAnimating || gameState.winner) return;
    
    const config = gameState.playerConfigs[gameState.currentPlayer - 1];
    if (config.type !== 'human') return;
    
    // For online games, only allow moves on your turn with debounce
    if (gameMode === 'online-game') {
      if (myPlayerNumber !== gameState.currentPlayer) {
        console.log('[App] Not your turn in online game');
        return;
      }
      // Debounce to prevent double clicks
      const now = Date.now();
      if (now - lastMoveTimeRef.current < MOVE_DEBOUNCE_MS) {
        console.log('[App] Move debounced - too fast');
        return;
      }
      lastMoveTimeRef.current = now;
    }
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const c = Math.floor(x / cellWidth);
    const r = Math.floor(y / cellHeight);
    
    executeMove(r, c, gameState.currentPlayer);
  };

  // Handle touch
  const handleCanvasTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!gameState || !gameState.gameActive || isAnimating || gameState.winner) return;
    
    const config = gameState.playerConfigs[gameState.currentPlayer - 1];
    if (config.type !== 'human') return;
    
    // For online games, only allow moves on your turn with debounce
    if (gameMode === 'online-game') {
      if (myPlayerNumber !== gameState.currentPlayer) {
        console.log('[App] Not your turn in online game');
        return;
      }
      // Debounce to prevent double taps
      const now = Date.now();
      if (now - lastMoveTimeRef.current < MOVE_DEBOUNCE_MS) {
        console.log('[App] Move debounced - too fast');
        return;
      }
      lastMoveTimeRef.current = now;
    }
    
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    
    const c = Math.floor(x / cellWidth);
    const r = Math.floor(y / cellHeight);
    
    executeMove(r, c, gameState.currentPlayer);
  };

  // Gamepad navigation
  const handleNavigate = useCallback((dx: number, dy: number) => {
    console.log('[Nav] Move:', dx, dy);
    setCursorPos(prev => {
      const newPos = {
        r: Math.max(0, Math.min(GRID_ROWS - 1, prev.r + dy)),
        c: Math.max(0, Math.min(GRID_COLS - 1, prev.c + dx)),
      };
      console.log('[Nav] Cursor:', prev.r, prev.c, '->', newPos.r, newPos.c);
      return newPos;
    });
  }, []);

  useGamepadNavigation(currentGamepad, handleNavigate);

  // Gamepad button press
  const handleButtonPress = useCallback((buttonIndex: number) => {
    if (!gameState || !gameState.gameActive || isAnimating || gameState.winner) return;
    
    const config = gameState.playerConfigs[gameState.currentPlayer - 1];
    if (config.type !== 'human' || config.controllerId === null) return;
    
    if (buttonIndex === GAMEPAD_BUTTONS.A) {
      executeMove(cursorPos.r, cursorPos.c, gameState.currentPlayer);
    }
  }, [gameState, isAnimating, cursorPos, executeMove]);

  useGamepadButtons(currentGamepad, handleButtonPress);

  // Render loop
  useEffect(() => {
    if (!canvasRef.current || !gameState) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let animationTime = 0;
    let animId: number;
    
    const draw = () => {
      animationTime += 0.02;
      
      // Clear
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, '#0a0f1a');
      bgGrad.addColorStop(1, '#050810');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw cells
      const queuedCells = new Set(explosionQueueRef.current.map(q => `${q.r},${q.c}`));
      
      for (const cell of gameState.grid) {
        const x = cell.c * cellWidth;
        const y = cell.r * cellHeight;
        const padding = 2;
        
        const cellColors = CELL_COLORS[cell.type];
        const isQueued = queuedCells.has(`${cell.r},${cell.c}`);
        
        // Pulse for cells near capacity or queued for explosion
        let fillOpacity = 1;
        if (cell.orbs > 0 && cell.orbs === cell.capacity) {
          fillOpacity = 0.7 + 0.3 * Math.sin(animationTime * 4 + cell.pulsePhase);
        }
        
        // Cell background - deep dark red if queued for explosion
        if (isQueued) {
          ctx.fillStyle = '#3d0a0a'; // Deep dark red
          ctx.globalAlpha = 0.9 + 0.1 * Math.sin(animationTime * 8);
        } else {
          ctx.fillStyle = cellColors.fill;
          ctx.globalAlpha = fillOpacity;
        }
        roundRect(ctx, x + padding, y + padding, cellWidth - padding * 2, cellHeight - padding * 2, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        // Owner glow
        if (cell.orbs > 0) {
          const ownerColor = PLAYER_COLORS[cell.owner as keyof typeof PLAYER_COLORS]?.glow || 'rgba(255,255,255,0.3)';
          ctx.fillStyle = ownerColor;
          ctx.globalAlpha = 0.15;
          roundRect(ctx, x + padding, y + padding, cellWidth - padding * 2, cellHeight - padding * 2, 6);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        
        // Border
        ctx.strokeStyle = cellColors.stroke;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        roundRect(ctx, x + padding, y + padding, cellWidth - padding * 2, cellHeight - padding * 2, 6);
        ctx.stroke();
        ctx.globalAlpha = 1;
        
        // Capacity indicator
        ctx.fillStyle = cellColors.stroke;
        ctx.globalAlpha = 0.3;
        ctx.font = '10px Orbitron, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(String(cell.capacity + 1), x + cellWidth - 6, y + 14);
        ctx.globalAlpha = 1;
      }
      
      // Draw orbs
      for (const cell of gameState.grid) {
        if (cell.orbs === 0) continue;
        
        const cx = cell.c * cellWidth + cellWidth / 2;
        const cy = cell.r * cellHeight + cellHeight / 2;
        const colors = PLAYER_COLORS[cell.owner as keyof typeof PLAYER_COLORS] || { primary: '#fff', secondary: '#ccc', glow: 'rgba(255,255,255,0.5)' };
        
        const radius = Math.min(cellWidth, cellHeight) * 0.14;
        const spacing = radius * 1.8;
        
        let pulseScale = 1;
        if (cell.orbs === cell.capacity) {
          pulseScale = 1 + 0.15 * Math.sin(animationTime * 6 + cell.pulsePhase);
        }
        
        const drawOrb = (ox: number, oy: number) => {
          ctx.shadowColor = colors.glow;
          ctx.shadowBlur = 15;
          
          const orbGrad = ctx.createRadialGradient(ox - radius * 0.3, oy - radius * 0.3, 0, ox, oy, radius * pulseScale);
          orbGrad.addColorStop(0, '#ffffff');
          orbGrad.addColorStop(0.3, colors.secondary);
          orbGrad.addColorStop(1, colors.primary);
          
          ctx.fillStyle = orbGrad;
          ctx.beginPath();
          ctx.arc(ox, oy, radius * pulseScale, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath();
          ctx.arc(ox - radius * 0.25, oy - radius * 0.25, radius * 0.3 * pulseScale, 0, Math.PI * 2);
          ctx.fill();
        };
        
        if (cell.orbs === 1) {
          drawOrb(cx, cy);
        } else if (cell.orbs === 2) {
          drawOrb(cx - spacing / 2, cy);
          drawOrb(cx + spacing / 2, cy);
        } else {
          drawOrb(cx, cy - spacing / 2);
          drawOrb(cx - spacing / 2, cy + spacing / 2);
          drawOrb(cx + spacing / 2, cy + spacing / 2);
        }
      }
      
      // Draw cursor for gamepad
      if (currentGamepad && currentPlayerConfig?.type === 'human') {
        const cursorColor = PLAYER_COLORS[gameState.currentPlayer as keyof typeof PLAYER_COLORS]?.primary || '#fff';
        
        ctx.strokeStyle = cursorColor;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(animationTime * 4);
        roundRect(ctx, cursorPos.c * cellWidth + 4, cursorPos.r * cellHeight + 4, cellWidth - 8, cellHeight - 8, 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      
      // Update and draw particles
      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= 0.04;
        
        if (p.life <= 0) return false;
        
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        
        return true;
      });
      
      // Update and draw shockwaves
      shockwavesRef.current = shockwavesRef.current.filter(sw => {
        sw.radius += 4;
        sw.life = 1 - (sw.radius / sw.maxRadius);
        
        if (sw.life <= 0) return false;
        
        ctx.globalAlpha = sw.life * 0.5;
        ctx.strokeStyle = sw.color;
        ctx.lineWidth = 3 * sw.life;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        
        return true;
      });
      
      // Update and draw flying orbs
      flyingOrbsRef.current = flyingOrbsRef.current.filter(orb => {
        orb.progress += 0.12;
        
        const sx = orb.startC * cellWidth + cellWidth / 2;
        const sy = orb.startR * cellHeight + cellHeight / 2;
        const tx = orb.endC * cellWidth + cellWidth / 2;
        const ty = orb.endR * cellHeight + cellHeight / 2;
        const cx = sx + (tx - sx) * orb.progress;
        const cy = sy + (ty - sy) * orb.progress;
        
        orb.trail.push({ x: cx, y: cy, life: 1.0 });
        orb.trail.forEach(t => t.life -= 0.15);
        orb.trail = orb.trail.filter(t => t.life > 0);
        
        // Draw trail
        orb.trail.forEach(t => {
          ctx.globalAlpha = t.life * 0.5;
          ctx.fillStyle = orb.color;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 4 * t.life, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        
        // Draw orb
        ctx.shadowColor = orb.glowColor;
        ctx.shadowBlur = 20;
        
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.3, orb.color);
        gradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        return orb.progress < 1;
      });
      
      animId = requestAnimationFrame(draw);
    };
    
    draw();
    
    return () => cancelAnimationFrame(animId);
  }, [gameState, dimensions, cellWidth, cellHeight, cursorPos, currentGamepad, currentPlayerConfig]);

  // Helper function for rounded rectangles
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Get player color
  const getPlayerColor = (player: number) => {
    return PLAYER_COLORS[player as keyof typeof PLAYER_COLORS]?.primary || '#fff';
  };

  // Render join prompt (when joining via URL link)
  if (gameMode === 'join-prompt') {
    return (
      <div className="menu-overlay">
        <div className="logo-container">
          <h1>Chain Reaction</h1>
          <p className="subtitle">Join Game</p>
        </div>
        
        <div className="join-prompt">
          <div className="game-code-display">
            <span className="label">Joining Game</span>
            <span className="code">{pendingJoinCode || joinCode}</span>
          </div>
          
          <div className="join-form">
            <input
              type="text"
              className="name-input large"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
            />
            
            <button
              className="menu-btn btn-join-big"
              onClick={handleJoinGame}
              disabled={!playerName.trim() || isConnecting}
            >
              {isConnecting ? '⏳ Joining...' : '🎮 Join Game'}
            </button>
          </div>
          
          <button
            className="btn-cancel"
            onClick={() => {
              setPendingJoinCode(null);
              setJoinCode('');
              setGameMode('menu');
            }}
          >
            ← Back to Menu
          </button>
          
          <div className="relay-status">
            🌐 Connected to {relayCount} relay{relayCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    );
  }

  // Render online lobby (waiting room)
  if (gameMode === 'online-lobby') {
    return (
      <div className="menu-overlay">
        <div className="logo-container">
          <h1>Chain Reaction</h1>
          <p className="subtitle">Waiting Room</p>
        </div>
        
        <div className="online-lobby">
          <div className="game-code-display">
            <span className="label">Game Code</span>
            <span className="code">{nostrMultiplayer.getGameCode()}</span>
          </div>
          
          <div className="share-section">
            <input
              type="text"
              className="share-input"
              value={nostrMultiplayer.getShareUrl()}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="btn-copy" onClick={copyShareLink}>
              {copied ? '✓ Copied!' : '📋 Copy Link'}
            </button>
          </div>
          
          <div className="players-list">
            <h3>Players ({onlinePlayers.length}/4)</h3>
            {onlinePlayers.map((player, idx) => (
              <div
                key={player.id}
                className="player-item"
                style={{ color: getPlayerColor(idx + 1) }}
              >
                <span className="player-number">P{idx + 1}</span>
                <span className="player-name">{player.name}</span>
                {player.id === nostrMultiplayer.getMyId() && <span className="you-badge">YOU</span>}
                {idx === 0 && <span className="host-badge">HOST</span>}
              </div>
            ))}
            
            {onlinePlayers.length < 4 && (
              <div className="waiting-message">
                ⏳ Waiting for more players...
              </div>
            )}
          </div>
          
          <div className="lobby-buttons">
            {isHost && (
              <button
                className="menu-btn btn-start"
                onClick={handleStartOnlineGame}
                disabled={onlinePlayers.length < 2}
              >
                ⚡ Start Game ({onlinePlayers.length}/2+ players)
              </button>
            )}
            
            {!isHost && (
              <div className="waiting-host">
                Waiting for host to start the game...
              </div>
            )}
            
            <button className="menu-btn btn-leave" onClick={handleLeaveGame}>
              ← Leave Game
            </button>
          </div>
          
          <div className="relay-status">
            🌐 Connected to {relayCount} relay{relayCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    );
  }

  // Render main menu with mode selection
  if (showMenu && gameMode === 'menu') {
    return (
      <div className="menu-overlay menu-home">
        <div className="menu-content">
          <div className="logo-container">
            <h1>Chain Reaction</h1>
            <p className="subtitle">1-4 Players • Local or Online</p>
          </div>

          <div className="mode-switch" role="group" aria-label="Choose setup mode">
            <button
              className={`mode-option ${menuMode === 'local' ? 'active' : ''}`}
              onClick={() => setMenuMode('local')}
            >
              🎮 Local Setup
            </button>
            <button
              className={`mode-option ${menuMode === 'online' ? 'active' : ''}`}
              onClick={() => setMenuMode('online')}
            >
              🌐 Online Setup
            </button>
          </div>

          <div className="mode-hint">
            {menuMode === 'local'
              ? 'Play on this device with friends or AI.'
              : 'Create or join a lobby to play online.'}
          </div>

          <div className="menu-body">
            {menuMode === 'online' ? (
              <div className="menu-section online-section">
                <h2>🌐 Online Multiplayer</h2>
                
                <div className="online-form">
                  <input
                    type="text"
                    className="name-input"
                    placeholder="Your Name"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={20}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        if (joinCode) handleJoinGame();
                        else handleCreateGame();
                      }
                    }}
                  />
                  
                  <div className="online-buttons">
                    <button
                      className="menu-btn btn-create"
                      onClick={handleCreateGame}
                      disabled={!playerName.trim() || isConnecting}
                    >
                      {isConnecting ? '...' : '+ Create Game'}
                    </button>
                    
                    <div className="join-section">
                      <input
                        type="text"
                        className="code-input"
                        placeholder="CODE"
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        maxLength={4}
                        onKeyPress={(e) => e.key === 'Enter' && handleJoinGame()}
                      />
                      <button
                        className="menu-btn btn-join"
                        onClick={handleJoinGame}
                        disabled={!playerName.trim() || !joinCode.trim() || isConnecting}
                      >
                        {isConnecting ? '...' : 'Join'}
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="relay-status small">
                  🌐 {relayCount > 0 ? `Connected to ${relayCount} relay${relayCount !== 1 ? 's' : ''}` : 'Connecting...'}
                </div>
              </div>
            ) : (
              <div className="menu-section">
                <h2>🎮 Local Game</h2>
                <div className="player-setup">
                  {playerConfigs.map((config, idx) => {
                    const playerNum = idx + 1;
                    const color = getPlayerColor(playerNum);
                    
                    return (
                      <button
                        key={idx}
                        className={`player-toggle ${config.type}`}
                        style={{ color, borderColor: config.type !== 'off' ? color : undefined }}
                        onClick={() => cyclePlayerType(idx)}
                      >
                        <span className="icon">
                          {config.type === 'human' ? '👤' : config.type === 'ai' ? '🤖' : '⭕'}
                        </span>
                        <span>P{playerNum}</span>
                        <span style={{ fontSize: '0.6rem' }}>
                          {config.type === 'human' ? 'HUMAN' : config.type === 'ai' ? 'AI' : 'OFF'}
                        </span>
                      </button>
                    );
                  })}
                </div>
                
                <button className="menu-btn btn-local" onClick={() => { setGameMode('local'); startGame(); }}>
                  ⚡ Start Local Game
                </button>
              </div>
            )}
          </div>

          {gamepads.length > 0 && (
            <div className={`gamepad-hint connected`}>
              🎮 {gamepads.length} Controller{gamepads.length > 1 ? 's' : ''} Connected
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render local game menu
  if (showMenu) {
    return (
      <div className="menu-overlay">
        <div className="logo-container">
          <h1>Chain Reaction</h1>
          <p className="subtitle">1-4 Players</p>
        </div>
        
        <div className="menu-section">
          <h2>Player Setup</h2>
          <div className="player-setup">
            {playerConfigs.map((config, idx) => {
              const playerNum = idx + 1;
              const color = getPlayerColor(playerNum);
              
              return (
                <button
                  key={idx}
                  className={`player-toggle ${config.type}`}
                  style={{ color, borderColor: config.type !== 'off' ? color : undefined }}
                  onClick={() => cyclePlayerType(idx)}
                >
                  <span className="icon">
                    {config.type === 'human' ? '👤' : config.type === 'ai' ? '🤖' : '⭕'}
                  </span>
                  <span>P{playerNum}</span>
                  <span style={{ fontSize: '0.6rem' }}>
                    {config.type === 'human' ? 'HUMAN' : config.type === 'ai' ? 'AI' : 'OFF'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        
        <div className="menu-buttons">
          <button className="menu-btn btn-start" onClick={startGame}>
            ⚡ Start Game
          </button>
          <button className="menu-btn btn-back" onClick={() => { setGameMode('menu'); setShowMenu(true); }}>
            ← Back
          </button>
        </div>
        
        <div className={`gamepad-hint ${gamepads.length > 0 ? 'connected' : ''}`}>
          {gamepads.length > 0 
            ? `🎮 ${gamepads.length} Controller${gamepads.length > 1 ? 's' : ''} Connected`
            : '🎮 Connect Controllers to Play'
          }
        </div>
        
        {gamepads.length > 0 && (
          <div className="menu-section" style={{ marginTop: 20 }}>
            <h2>Assign Controllers</h2>
            <div className="player-setup">
              {playerConfigs.map((config, idx) => {
                if (config.type !== 'human') return null;
                const playerNum = idx + 1;
                const color = getPlayerColor(playerNum);
                
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color, fontSize: '0.7rem', fontFamily: 'Orbitron' }}>P{playerNum}</span>
                    <select
                      value={config.controllerId ?? -1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        assignController(idx, val === -1 ? null : val);
                      }}
                      style={{
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text-primary)',
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontFamily: 'Orbitron',
                        fontSize: '0.7rem',
                      }}
                    >
                      <option value={-1}>Keyboard/Mouse</option>
                      {gamepads.map((gp) => (
                          <option key={gp.index} value={gp.index}>
                            Controller {gp.index + 1}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Get turn text for online games
  const getOnlineTurnText = () => {
    if (!gameState) return '';
    if (gameState.winner) {
      const winnerPlayer = onlinePlayers.find(p => p.playerNumber === gameState.winner);
      return `🏆 ${winnerPlayer?.name?.toUpperCase() || PLAYER_NAMES[gameState.winner]} WINS!`;
    }
    if (gameMode === 'online-game') {
      const currentOnlinePlayer = onlinePlayers.find(p => p.playerNumber === gameState.currentPlayer);
      if (myPlayerNumber === gameState.currentPlayer) {
        return 'YOUR TURN';
      }
      return `${currentOnlinePlayer?.name?.toUpperCase() || 'OPPONENT'}'S TURN`;
    }
    return `${PLAYER_NAMES[gameState.currentPlayer]}'S TURN`;
  };

  // Render game
  return (
    <>
      <div className="game-header">
        <div className="player-badges">
          {gameMode === 'online-game' ? (
            // Online game - show player names
            onlinePlayers.map((player, idx) => {
              const playerNum = player.playerNumber || (idx + 1);
              const color = getPlayerColor(playerNum);
              const isActive = playerNum === gameState.currentPlayer && !gameState?.winner;
              const isEliminated = gameState && gameState.movesMade >= gameState.activePlayers.length && 
                !gameState.grid.some(c => c.owner === playerNum && c.orbs > 0);
              const isMe = player.id === nostrMultiplayer.getMyId();
              
              return (
                <div
                  key={player.id}
                  className={`player-badge ${isActive ? 'active' : ''} ${isEliminated ? 'eliminated' : ''}`}
                  style={{ color, borderColor: color }}
                >
                  {isMe ? '👤' : '🌐'} {player.name}
                </div>
              );
            })
          ) : (
            // Local game - show player numbers
            gameState?.activePlayers.map(player => {
              const config = playerConfigs[player - 1];
              const color = getPlayerColor(player);
              const isActive = player === gameState.currentPlayer && !gameState.winner;
              const isEliminated = gameState.movesMade >= gameState.activePlayers.length && 
                !gameState.grid.some(c => c.owner === player && c.orbs > 0);
              
              return (
                <div
                  key={player}
                  className={`player-badge ${isActive ? 'active' : ''} ${isEliminated ? 'eliminated' : ''}`}
                  style={{ color, borderColor: color }}
                >
                  {config.type === 'ai' ? '🤖' : config.type === 'network' ? '🌐' : '👤'} P{player}
                </div>
              );
            })
          )}
        </div>
        
        <div
          className={`turn-indicator ${gameState?.winner ? 'winner-animation' : ''} ${gameMode === 'online-game' && myPlayerNumber === gameState?.currentPlayer ? 'my-turn' : ''}`}
          style={{ color: gameState ? getPlayerColor(gameState.winner || gameState.currentPlayer) : '#fff' }}
        >
          {getOnlineTurnText()}
        </div>
        
        <button
          className="btn"
          style={{ padding: '8px 16px', fontSize: '0.7rem' }}
          onClick={() => {
            if (gameMode === 'online-game') {
              handleLeaveGame();
            } else {
              setShowMenu(true);
            }
          }}
        >
          {gameMode === 'online-game' ? 'LEAVE' : 'MENU'}
        </button>
      </div>
      
      <div className="canvas-container" ref={containerRef}>
        <div className="game-frame">
          <canvas
            ref={canvasRef}
            className="game-canvas"
            width={dimensions.width}
            height={dimensions.height}
            style={{ width: dimensions.width, height: dimensions.height }}
            onClick={handleCanvasClick}
            onTouchStart={handleCanvasTouch}
          />
        </div>
        
        {gameState?.winner && gameMode !== 'online-game' && (
          <button className="btn btn-restart" onClick={restartGame}>
            ⟳ Play Again
          </button>
        )}
        
        {gameState?.winner && gameMode === 'online-game' && (
          <button className="btn btn-restart" onClick={handleLeaveGame}>
            ← Back to Menu
          </button>
        )}
        
        <div className="cell-legend">
          <div className="legend-item">
            <div className="legend-dot corner" />
            <span>CORNER (2)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot edge" />
            <span>EDGE (3)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot center" />
            <span>CENTER (4)</span>
          </div>
        </div>
      </div>
      
      {/* Controller status */}
      <div className="controller-status">
        {gameMode === 'online-game' && (
          <div className="controller-badge connected">
            🌐 Online
          </div>
        )}
        {gamepads.map((gp) => (
          <div key={gp.index} className="controller-badge connected">
            🎮 Controller {gp.index + 1}
          </div>
        ))}
      </div>
    </>
  );
}
