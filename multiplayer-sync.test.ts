// Tests for multiplayer turn synchronization
// This test simulates two players and verifies they stay in sync

import { describe, it, expect, beforeEach } from 'vitest';

// Simplified game state for testing synchronization
interface GameState {
  currentPlayer: number;  // 1 or 2
  movesMade: number;
  activePlayers: number[];
}

// Simplified NostrMultiplayer state
interface MultiplayerState {
  currentPlayerIndex: number;  // 0 or 1
  players: { id: string; playerNumber: number }[];
  movesMade: number;
}

// Simulate a player's view of the game
class PlayerSimulator {
  id: string;
  name: string;
  gameState: GameState;
  multiplayerState: MultiplayerState;
  
  constructor(id: string, name: string, players: { id: string; playerNumber: number }[]) {
    this.id = id;
    this.name = name;
    this.gameState = {
      currentPlayer: 1,  // Game always starts with player 1
      movesMade: 0,
      activePlayers: [1, 2],
    };
    this.multiplayerState = {
      currentPlayerIndex: 0,
      players: players,
      movesMade: 0,
    };
  }
  
  getMyPlayerNumber(): number {
    return this.multiplayerState.players.find(p => p.id === this.id)?.playerNumber || 0;
  }
  
  // Check if it's my turn using NostrMultiplayer logic
  isMyTurn(): boolean {
    const current = this.multiplayerState.players[this.multiplayerState.currentPlayerIndex];
    return current?.id === this.id;
  }
  
  // Check if it's my turn using GameState logic (alternative approach)
  isMyTurnFromGameState(): boolean {
    return this.gameState.currentPlayer === this.getMyPlayerNumber();
  }
  
  // Advance the NostrMultiplayer state
  advancePlayer(): void {
    this.multiplayerState.currentPlayerIndex = 
      (this.multiplayerState.currentPlayerIndex + 1) % this.multiplayerState.players.length;
    this.multiplayerState.movesMade++;
  }
  
  // Execute a local move (I made a move)
  executeLocalMove(): void {
    // Update game state
    const newMovesMade = this.gameState.movesMade + 1;
    const nextPlayer = this.getNextPlayer();
    this.gameState.movesMade = newMovesMade;
    this.gameState.currentPlayer = nextPlayer;
    
    // Advance multiplayer state (this is what the bug causes)
    this.advancePlayer();
  }
  
  // Execute a remote move (other player made a move, I received it)
  executeRemoteMove(): void {
    // Update game state (same as local)
    const newMovesMade = this.gameState.movesMade + 1;
    const nextPlayer = this.getNextPlayer();
    this.gameState.movesMade = newMovesMade;
    this.gameState.currentPlayer = nextPlayer;
    
    // BUG: This also advances multiplayer state!
    this.advancePlayer();
  }
  
  private getNextPlayer(): number {
    // Simple 2-player rotation
    const currentIdx = this.gameState.activePlayers.indexOf(this.gameState.currentPlayer);
    return this.gameState.activePlayers[(currentIdx + 1) % this.gameState.activePlayers.length];
  }
  
  getStatus(): string {
    return `${this.name}: GameState.currentPlayer=${this.gameState.currentPlayer}, ` +
           `MultiplayerState.currentPlayerIndex=${this.multiplayerState.currentPlayerIndex}, ` +
           `isMyTurn=${this.isMyTurn()}, isMyTurnFromGameState=${this.isMyTurnFromGameState()}`;
  }
}

describe('Multiplayer Turn Synchronization Bug', () => {
  let player1: PlayerSimulator;
  let player2: PlayerSimulator;
  
  beforeEach(() => {
    const players = [
      { id: 'p1', playerNumber: 1 },
      { id: 'p2', playerNumber: 2 },
    ];
    
    player1 = new PlayerSimulator('p1', 'Player1', [...players]);
    player2 = new PlayerSimulator('p2', 'Player2', [...players]);
  });
  
  it('should start with correct initial state', () => {
    // Player 1 should think it's their turn
    expect(player1.isMyTurn()).toBe(true);
    expect(player1.isMyTurnFromGameState()).toBe(true);
    
    // Player 2 should think it's NOT their turn
    expect(player2.isMyTurn()).toBe(false);
    expect(player2.isMyTurnFromGameState()).toBe(false);
  });
  
  it('should stay in sync after player 1 moves', () => {
    console.log('Initial state:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Player 1 makes a move (local execution)
    player1.executeLocalMove();
    
    // Player 2 receives the move (remote execution)
    player2.executeRemoteMove();
    
    console.log('\nAfter player 1 moves:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Now it should be player 2's turn
    // Player 1 should think it's NOT their turn
    expect(player1.isMyTurn()).toBe(false);
    expect(player1.isMyTurnFromGameState()).toBe(false);
    
    // Player 2 should think it IS their turn
    expect(player2.isMyTurn()).toBe(true);
    expect(player2.isMyTurnFromGameState()).toBe(true);
  });
  
  it('should stay in sync after player 2 moves', () => {
    // Player 1 makes first move
    player1.executeLocalMove();
    player2.executeRemoteMove();
    
    console.log('After player 1 moves:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Player 2 makes second move (local for p2)
    player2.executeLocalMove();
    
    // Player 1 receives the move (remote for p1)
    player1.executeRemoteMove();
    
    console.log('\nAfter player 2 moves:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Now it should be player 1's turn again
    expect(player1.isMyTurn()).toBe(true);
    expect(player1.isMyTurnFromGameState()).toBe(true);
    
    expect(player2.isMyTurn()).toBe(false);
    expect(player2.isMyTurnFromGameState()).toBe(false);
  });
  
  it('DEMONSTRATES THE BUG: after several moves, both think its the other\'s turn', () => {
    // This test demonstrates the bug the user reported
    // After a few moves, both players think it's the other's turn
    
    console.log('=== DEMONSTRATING THE BUG ===');
    console.log('Move 0 - Initial state:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Move 1: Player 1 moves
    player1.executeLocalMove();
    player2.executeRemoteMove();
    
    console.log('\nMove 1 - Player 1 moved:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Move 2: Player 2 moves
    player2.executeLocalMove();
    player1.executeRemoteMove();
    
    console.log('\nMove 2 - Player 2 moved:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Move 3: Player 1 moves
    player1.executeLocalMove();
    player2.executeRemoteMove();
    
    console.log('\nMove 3 - Player 1 moved:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Move 4: Player 2 moves  
    player2.executeLocalMove();
    player1.executeRemoteMove();
    
    console.log('\nMove 4 - Player 2 moved:');
    console.log(player1.getStatus());
    console.log(player2.getStatus());
    
    // Check if the isMyTurn() values are correct
    // At this point it should be player 1's turn
    const p1IsMyTurn = player1.isMyTurn();
    const p2IsMyTurn = player2.isMyTurn();
    
    console.log('\n=== ANALYSIS ===');
    console.log(`Player 1 thinks isMyTurn: ${p1IsMyTurn}`);
    console.log(`Player 2 thinks isMyTurn: ${p2IsMyTurn}`);
    
    // The BUG: Using isMyTurn() (from NostrMultiplayer.currentPlayerIndex) may give wrong results
    // because both players call advancePlayer() and their local indexes get out of sync
    
    // The fix: Use isMyTurnFromGameState() which checks the actual game state
    const p1IsMyTurnCorrect = player1.isMyTurnFromGameState();
    const p2IsMyTurnCorrect = player2.isMyTurnFromGameState();
    
    console.log(`Player 1 isMyTurnFromGameState: ${p1IsMyTurnCorrect}`);
    console.log(`Player 2 isMyTurnFromGameState: ${p2IsMyTurnCorrect}`);
    
    // Verify game state is consistent between players
    expect(player1.gameState.currentPlayer).toBe(player2.gameState.currentPlayer);
    expect(player1.gameState.movesMade).toBe(player2.gameState.movesMade);
    
    // The GameState-based check should always give consistent results
    expect(p1IsMyTurnCorrect).not.toBe(p2IsMyTurnCorrect); // Exactly one player's turn
    
    // NOTE: This test may fail if the NostrMultiplayer indexes are out of sync
    // This demonstrates that isMyTurnFromGameState() is the reliable approach
  });
});

describe('Network Delay Simulation - The Real Bug', () => {
  // This simulates what happens with network delays where events arrive at different times
  
  class AsyncPlayerSimulator {
    id: string;
    name: string;
    gameState: GameState;
    multiplayerState: MultiplayerState;
    pendingMoves: { r: number; c: number; player: number; moveNumber: number }[] = [];
    
    constructor(id: string, name: string, players: { id: string; playerNumber: number }[]) {
      this.id = id;
      this.name = name;
      this.gameState = {
        currentPlayer: 1,
        movesMade: 0,
        activePlayers: [1, 2],
      };
      this.multiplayerState = {
        currentPlayerIndex: 0,
        players: players,
        movesMade: 0,
      };
    }
    
    getMyPlayerNumber(): number {
      return this.multiplayerState.players.find(p => p.id === this.id)?.playerNumber || 0;
    }
    
    // OLD BUGGY METHOD: uses NostrMultiplayer's currentPlayerIndex
    isMyTurnBuggy(): boolean {
      const current = this.multiplayerState.players[this.multiplayerState.currentPlayerIndex];
      return current?.id === this.id;
    }
    
    // FIXED METHOD: uses GameState's currentPlayer
    isMyTurnFixed(): boolean {
      return this.gameState.currentPlayer === this.getMyPlayerNumber();
    }
    
    executeMove(advanceMultiplayer: boolean = true): void {
      const newMovesMade = this.gameState.movesMade + 1;
      const currentIdx = this.gameState.activePlayers.indexOf(this.gameState.currentPlayer);
      const nextPlayer = this.gameState.activePlayers[(currentIdx + 1) % this.gameState.activePlayers.length];
      this.gameState.movesMade = newMovesMade;
      this.gameState.currentPlayer = nextPlayer;
      
      if (advanceMultiplayer) {
        this.multiplayerState.currentPlayerIndex = 
          (this.multiplayerState.currentPlayerIndex + 1) % this.multiplayerState.players.length;
        this.multiplayerState.movesMade++;
      }
    }
    
    // Simulate receiving a move late (without advancing multiplayer state)
    executeMoveWithoutAdvance(): void {
      this.executeMove(false);
    }
    
    advanceMultiplayerOnly(): void {
      this.multiplayerState.currentPlayerIndex = 
        (this.multiplayerState.currentPlayerIndex + 1) % this.multiplayerState.players.length;
      this.multiplayerState.movesMade++;
    }
  }
  
  it('should demonstrate bug when network events arrive late', () => {
    const players = [
      { id: 'p1', playerNumber: 1 },
      { id: 'p2', playerNumber: 2 },
    ];
    
    const player1 = new AsyncPlayerSimulator('p1', 'Player1', [...players]);
    const player2 = new AsyncPlayerSimulator('p2', 'Player2', [...players]);
    
    console.log('=== SIMULATING NETWORK DELAY BUG ===\n');
    
    // Move 1: Player 1 makes a move
    console.log('Step 1: Player 1 makes a move (executes locally)');
    player1.executeMove(true);  // P1 advances both game state and multiplayer state
    
    console.log('Step 2: Player 2 receives the move (with network delay)');
    // Simulating: P2 receives move but there's a timing issue with explosion chain
    // In real code, this can happen when explosion chains take different times
    player2.executeMoveWithoutAdvance();  // Game state advances but not multiplayer
    
    console.log('\nAfter Move 1:');
    console.log(`P1: GameState.currentPlayer=${player1.gameState.currentPlayer}, MP.index=${player1.multiplayerState.currentPlayerIndex}`);
    console.log(`P2: GameState.currentPlayer=${player2.gameState.currentPlayer}, MP.index=${player2.multiplayerState.currentPlayerIndex}`);
    console.log(`P1 isMyTurnBuggy: ${player1.isMyTurnBuggy()}, isMyTurnFixed: ${player1.isMyTurnFixed()}`);
    console.log(`P2 isMyTurnBuggy: ${player2.isMyTurnBuggy()}, isMyTurnFixed: ${player2.isMyTurnFixed()}`);
    
    // Now P2 belatedly advances their multiplayer state
    console.log('\nStep 3: P2 multiplayer state catches up');
    player2.advanceMultiplayerOnly();
    
    // Move 2: Player 2 tries to make a move, but explosion chain delays things
    console.log('\nStep 4: Player 2 makes a move');
    player2.executeMove(true);
    
    // P1 receives but with timing issues
    console.log('Step 5: Player 1 receives with timing issue');
    player1.executeMoveWithoutAdvance();
    
    console.log('\nAfter Move 2 (before P1 MP catches up):');
    console.log(`P1: GameState.currentPlayer=${player1.gameState.currentPlayer}, MP.index=${player1.multiplayerState.currentPlayerIndex}`);
    console.log(`P2: GameState.currentPlayer=${player2.gameState.currentPlayer}, MP.index=${player2.multiplayerState.currentPlayerIndex}`);
    console.log(`P1 isMyTurnBuggy: ${player1.isMyTurnBuggy()}, isMyTurnFixed: ${player1.isMyTurnFixed()}`);
    console.log(`P2 isMyTurnBuggy: ${player2.isMyTurnBuggy()}, isMyTurnFixed: ${player2.isMyTurnFixed()}`);
    
    // At this point:
    // - GameState says it's Player 1's turn (correct for both)
    // - But P1's MP.index is out of sync, so isMyTurnBuggy might be wrong
    
    // The FIXED method always works because it uses GameState
    expect(player1.isMyTurnFixed()).toBe(true);
    expect(player2.isMyTurnFixed()).toBe(false);
    
    // Verify game states are in sync
    expect(player1.gameState.currentPlayer).toBe(player2.gameState.currentPlayer);
  });
});

describe('Fixed Turn Synchronization', () => {
  // This demonstrates the fix: use game state's currentPlayer, not NostrMultiplayer's currentPlayerIndex
  
  class FixedPlayerSimulator {
    id: string;
    name: string;
    gameState: GameState;
    myPlayerNumber: number;
    
    constructor(id: string, name: string, playerNumber: number) {
      this.id = id;
      this.name = name;
      this.myPlayerNumber = playerNumber;
      this.gameState = {
        currentPlayer: 1,
        movesMade: 0,
        activePlayers: [1, 2],
      };
    }
    
    // FIXED: Check turn based on game state only
    isMyTurn(): boolean {
      return this.gameState.currentPlayer === this.myPlayerNumber;
    }
    
    executeMove(): void {
      const newMovesMade = this.gameState.movesMade + 1;
      const currentIdx = this.gameState.activePlayers.indexOf(this.gameState.currentPlayer);
      const nextPlayer = this.gameState.activePlayers[(currentIdx + 1) % this.gameState.activePlayers.length];
      this.gameState.movesMade = newMovesMade;
      this.gameState.currentPlayer = nextPlayer;
    }
    
    getStatus(): string {
      return `${this.name}: currentPlayer=${this.gameState.currentPlayer}, isMyTurn=${this.isMyTurn()}`;
    }
  }
  
  it('should stay in sync using game state only', () => {
    const player1 = new FixedPlayerSimulator('p1', 'Player1', 1);
    const player2 = new FixedPlayerSimulator('p2', 'Player2', 2);
    
    console.log('=== FIXED IMPLEMENTATION ===');
    
    // Simulate 10 moves
    for (let move = 1; move <= 10; move++) {
      const whoseTurn = (move % 2 === 1) ? 'Player 1' : 'Player 2';
      
      // Check before move
      if (move % 2 === 1) {
        expect(player1.isMyTurn()).toBe(true);
        expect(player2.isMyTurn()).toBe(false);
      } else {
        expect(player1.isMyTurn()).toBe(false);
        expect(player2.isMyTurn()).toBe(true);
      }
      
      // Execute the move on BOTH players (simulating network sync)
      player1.executeMove();
      player2.executeMove();
      
      console.log(`After move ${move} (${whoseTurn}): ` +
        `P1.currentPlayer=${player1.gameState.currentPlayer}, ` +
        `P2.currentPlayer=${player2.gameState.currentPlayer}`);
      
      // Verify they're in sync
      expect(player1.gameState.currentPlayer).toBe(player2.gameState.currentPlayer);
    }
    
    console.log('\n=== All 10 moves completed without sync issues! ===');
  });
});
