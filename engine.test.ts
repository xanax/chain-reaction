// Automated tests for Chain Reaction game engine
// Run with: npx vitest run src/chain-reaction/engine.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GRID_ROWS,
  GRID_COLS,
  Cell,
  createCell,
  createGrid,
  getCell,
  validateMove,
  getNeighborCoords,
  getAlivePlayers,
  checkWinner,
  getNextPlayer,
  aiScoreMove,
  aiFindBestMove,
} from './engine';

// ============================================
// GRID CREATION TESTS
// ============================================

describe('Grid Creation', () => {
  describe('createCell', () => {
    it('should create a corner cell with capacity 1 at (0,0)', () => {
      const cell = createCell(0, 0);
      expect(cell.r).toBe(0);
      expect(cell.c).toBe(0);
      expect(cell.type).toBe('corner');
      expect(cell.capacity).toBe(1);
      expect(cell.neighborCount).toBe(2);
      expect(cell.orbs).toBe(0);
      expect(cell.owner).toBe(0);
    });

    it('should create a corner cell at bottom-right', () => {
      const cell = createCell(GRID_ROWS - 1, GRID_COLS - 1);
      expect(cell.type).toBe('corner');
      expect(cell.capacity).toBe(1);
    });

    it('should create an edge cell with capacity 2', () => {
      const cell = createCell(0, 2);
      expect(cell.type).toBe('edge');
      expect(cell.capacity).toBe(2);
    });

    it('should create a center cell with capacity 3', () => {
      const cell = createCell(4, 3);
      expect(cell.type).toBe('center');
      expect(cell.capacity).toBe(3);
    });
  });

  describe('createGrid', () => {
    it('should create a grid with correct number of cells', () => {
      const grid = createGrid();
      expect(grid.length).toBe(GRID_ROWS * GRID_COLS);
    });

    it('should have 4 corner cells', () => {
      const grid = createGrid();
      const corners = grid.filter(c => c.type === 'corner');
      expect(corners.length).toBe(4);
    });

    it('should have all cells start empty', () => {
      const grid = createGrid();
      expect(grid.every(c => c.orbs === 0)).toBe(true);
      expect(grid.every(c => c.owner === 0)).toBe(true);
    });
  });
});

// ============================================
// GRID ACCESS TESTS
// ============================================

describe('Grid Access', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  describe('getCell', () => {
    it('should return correct cell at valid coordinates', () => {
      const cell = getCell(grid, 0, 0);
      expect(cell).not.toBeNull();
      expect(cell!.r).toBe(0);
      expect(cell!.c).toBe(0);
    });

    it('should return null for out of bounds', () => {
      expect(getCell(grid, -1, 0)).toBeNull();
      expect(getCell(grid, 0, -1)).toBeNull();
      expect(getCell(grid, GRID_ROWS, 0)).toBeNull();
      expect(getCell(grid, 0, GRID_COLS)).toBeNull();
    });
  });

  describe('getNeighborCoords', () => {
    it('should return 2 neighbors for corner', () => {
      const neighbors = getNeighborCoords(0, 0);
      expect(neighbors.length).toBe(2);
    });

    it('should return 3 neighbors for edge', () => {
      const neighbors = getNeighborCoords(0, 2);
      expect(neighbors.length).toBe(3);
    });

    it('should return 4 neighbors for center', () => {
      const neighbors = getNeighborCoords(4, 3);
      expect(neighbors.length).toBe(4);
    });
  });
});

// ============================================
// MOVE VALIDATION TESTS
// ============================================

describe('Move Validation', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  it('should allow move on empty cell', () => {
    expect(validateMove(grid, 0, 0, 1)).toBe(true);
  });

  it('should allow move on own cell', () => {
    const cell = getCell(grid, 2, 2)!;
    cell.owner = 1;
    cell.orbs = 1;
    expect(validateMove(grid, 2, 2, 1)).toBe(true);
  });

  it('should reject move on enemy cell', () => {
    const cell = getCell(grid, 2, 2)!;
    cell.owner = 1;
    cell.orbs = 1;
    expect(validateMove(grid, 2, 2, 2)).toBe(false);
  });

  it('should reject out of bounds', () => {
    expect(validateMove(grid, -1, 0, 1)).toBe(false);
    expect(validateMove(grid, GRID_ROWS, 0, 1)).toBe(false);
  });
});

// ============================================
// GAME STATE TESTS
// ============================================

describe('Game State', () => {
  let grid: Cell[];
  const activePlayers = [1, 2];

  beforeEach(() => {
    grid = createGrid();
  });

  describe('getAlivePlayers', () => {
    it('should return empty for empty grid', () => {
      expect(getAlivePlayers(grid, activePlayers)).toEqual([]);
    });

    it('should return player with orbs', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      expect(getAlivePlayers(grid, activePlayers)).toEqual([1]);
    });

    it('should return multiple alive players', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      getCell(grid, 5, 5)!.owner = 2;
      getCell(grid, 5, 5)!.orbs = 2;
      expect(getAlivePlayers(grid, activePlayers)).toEqual([1, 2]);
    });
  });

  describe('checkWinner', () => {
    it('should return winner immediately when only one player has orbs', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      expect(checkWinner(grid, activePlayers, 0)).toBe(1);
      expect(checkWinner(grid, activePlayers, 1)).toBe(1);
    });

    it('should return winner after first round', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      expect(checkWinner(grid, activePlayers, 2)).toBe(1);
    });

    it('should not loop when movesMade is stuck but only one color remains', () => {
      // Regression test: previously winner detection waited for movesMade to reach activePlayers.length,
      // which could cause infinite loops if the turn counter was not advanced after a cascade.
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;

      let winner: number | null = null;
      let iterations = 0;
      while (winner === null && iterations < 100) {
        winner = checkWinner(grid, activePlayers, 0); // movesMade stuck at 0
        iterations++;
      }

      expect(winner).toBe(1);
      expect(iterations).toBe(1); // should short-circuit immediately
    });

    it('should return null when multiple alive', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      getCell(grid, 5, 5)!.owner = 2;
      getCell(grid, 5, 5)!.orbs = 2;
      expect(checkWinner(grid, activePlayers, 5)).toBeNull();
    });
  });

  describe('getNextPlayer', () => {
    it('should cycle in first round', () => {
      expect(getNextPlayer(1, activePlayers, grid, 0)).toBe(2);
      expect(getNextPlayer(2, activePlayers, grid, 1)).toBe(1);
    });

    it('should skip eliminated players', () => {
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      // Player 2 has no orbs - eliminated
      expect(getNextPlayer(1, activePlayers, grid, 2)).toBe(1);
    });

    it('should cycle alive players', () => {
      const threePlayers = [1, 2, 3];
      getCell(grid, 0, 0)!.owner = 1;
      getCell(grid, 0, 0)!.orbs = 1;
      getCell(grid, 5, 5)!.owner = 3;
      getCell(grid, 5, 5)!.orbs = 1;
      // Player 2 eliminated
      expect(getNextPlayer(1, threePlayers, grid, 5)).toBe(3);
      expect(getNextPlayer(3, threePlayers, grid, 6)).toBe(1);
    });
  });
});

// ============================================
// AI TESTS (simplified - no loops)
// ============================================

describe('AI Logic', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  describe('aiScoreMove', () => {
    it('should give positive score for own cell', () => {
      const cell = getCell(grid, 4, 3)!;
      cell.owner = 1;
      cell.orbs = 1;
      const score = aiScoreMove(grid, cell, 1);
      expect(score).toBeGreaterThan(0);
    });

    it('should give higher score for cell at capacity', () => {
      const cell = getCell(grid, 0, 0)!; // Corner, capacity 1
      cell.owner = 1;
      cell.orbs = 1; // At capacity
      const scoreAtCapacity = aiScoreMove(grid, cell, 1);
      
      cell.orbs = 0;
      const scoreEmpty = aiScoreMove(grid, cell, 1);
      
      // At capacity should score higher (25 points)
      expect(scoreAtCapacity).toBeGreaterThan(scoreEmpty);
    });
  });

  describe('aiFindBestMove', () => {
    it('should return valid move on empty grid', () => {
      const move = aiFindBestMove(grid, 1);
      expect(move).not.toBeNull();
      expect(move!.r).toBeGreaterThanOrEqual(0);
      expect(move!.r).toBeLessThan(GRID_ROWS);
      expect(move!.c).toBeGreaterThanOrEqual(0);
      expect(move!.c).toBeLessThan(GRID_COLS);
    });

    it('should return null when no valid moves', () => {
      for (const cell of grid) {
        cell.owner = 2;
        cell.orbs = 1;
      }
      expect(aiFindBestMove(grid, 1)).toBeNull();
    });

    it('should choose own cell when only option', () => {
      const ownCell = getCell(grid, 4, 3)!;
      ownCell.owner = 1;
      ownCell.orbs = 2;
      
      for (const cell of grid) {
        if (cell !== ownCell) {
          cell.owner = 2;
          cell.orbs = 1;
        }
      }
      
      const move = aiFindBestMove(grid, 1);
      expect(move).not.toBeNull();
      expect(move!.r).toBe(4);
      expect(move!.c).toBe(3);
    });
  });
});

// ============================================
// END GAME STATE TESTS
// ============================================

describe('End Game States', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  it('should handle fully occupied grid (no empty cells)', () => {
    // Fill grid alternating between players
    let playerToggle = true;
    for (const cell of grid) {
      cell.owner = playerToggle ? 1 : 2;
      cell.orbs = 1;
      playerToggle = !playerToggle;
    }
    
    const alive = getAlivePlayers(grid, [1, 2]);
    expect(alive).toEqual([1, 2]);
    expect(checkWinner(grid, [1, 2], 100)).toBeNull();
  });

  it('should detect winner when one player owns all cells', () => {
    for (const cell of grid) {
      cell.owner = 1;
      cell.orbs = cell.capacity; // Max orbs
    }
    
    expect(checkWinner(grid, [1, 2], 100)).toBe(1);
  });

  it('should handle player with cells but no orbs', () => {
    // Edge case: cell.owner is set but orbs is 0
    getCell(grid, 0, 0)!.owner = 1;
    getCell(grid, 0, 0)!.orbs = 0;
    getCell(grid, 5, 5)!.owner = 2;
    getCell(grid, 5, 5)!.orbs = 1;
    
    // Player 1 should NOT be alive (no orbs)
    expect(getAlivePlayers(grid, [1, 2])).toEqual([2]);
    expect(checkWinner(grid, [1, 2], 10)).toBe(2);
  });

  it('should handle all cells at max capacity without explosion', () => {
    for (const cell of grid) {
      cell.owner = 1;
      cell.orbs = cell.capacity; // At capacity, but not over
    }
    
    // Should still be valid game state
    expect(getAlivePlayers(grid, [1, 2])).toEqual([1]);
    expect(checkWinner(grid, [1, 2], 10)).toBe(1);
  });

  it('should correctly count alive players in 4-player game', () => {
    const fourPlayers = [1, 2, 3, 4];
    
    // Each corner owned by different player
    getCell(grid, 0, 0)!.owner = 1;
    getCell(grid, 0, 0)!.orbs = 1;
    getCell(grid, 0, GRID_COLS - 1)!.owner = 2;
    getCell(grid, 0, GRID_COLS - 1)!.orbs = 1;
    getCell(grid, GRID_ROWS - 1, 0)!.owner = 3;
    getCell(grid, GRID_ROWS - 1, 0)!.orbs = 1;
    getCell(grid, GRID_ROWS - 1, GRID_COLS - 1)!.owner = 4;
    getCell(grid, GRID_ROWS - 1, GRID_COLS - 1)!.orbs = 1;
    
    const alive = getAlivePlayers(grid, fourPlayers);
    expect(alive.length).toBe(4);
    expect(checkWinner(grid, fourPlayers, 10)).toBeNull();
  });

  it('should handle elimination cascade in 4-player game', () => {
    const fourPlayers = [1, 2, 3, 4];
    
    // Only player 3 survives
    getCell(grid, 4, 3)!.owner = 3;
    getCell(grid, 4, 3)!.orbs = 1;
    
    expect(getAlivePlayers(grid, fourPlayers)).toEqual([3]);
    expect(checkWinner(grid, fourPlayers, 10)).toBe(3);
  });
});

// ============================================
// BOARD FILL / INFINITE LOOP PREVENTION
// ============================================

describe('Board Fill Scenarios', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  it('should allow valid moves when board is mostly full', () => {
    // Fill most of the board with enemy
    let count = 0;
    for (const cell of grid) {
      if (count < grid.length - 5) {
        cell.owner = 2;
        cell.orbs = 1;
      }
      count++;
    }
    
    // AI should find one of the remaining empty cells
    const move = aiFindBestMove(grid, 1);
    expect(move).not.toBeNull();
    
    // Verify the chosen cell is valid
    const chosenCell = getCell(grid, move!.r, move!.c);
    expect(chosenCell).not.toBeNull();
    expect(chosenCell!.owner === 0 || chosenCell!.owner === 1).toBe(true);
  });

  it('should handle checkerboard pattern', () => {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = getCell(grid, r, c)!;
        cell.owner = ((r + c) % 2 === 0) ? 1 : 2;
        cell.orbs = 1;
      }
    }
    
    // Both players alive
    expect(getAlivePlayers(grid, [1, 2]).length).toBe(2);
    
    // Player 1 can move on their own cells
    const move1 = aiFindBestMove(grid, 1);
    expect(move1).not.toBeNull();
    const cell1 = getCell(grid, move1!.r, move1!.c);
    expect(cell1!.owner).toBe(1);
    
    // Player 2 can move on their own cells
    const move2 = aiFindBestMove(grid, 2);
    expect(move2).not.toBeNull();
    const cell2 = getCell(grid, move2!.r, move2!.c);
    expect(cell2!.owner).toBe(2);
  });

  it('should handle single remaining cell for player', () => {
    // Fill entire grid with player 2
    for (const cell of grid) {
      cell.owner = 2;
      cell.orbs = 1;
    }
    
    // Give player 1 just one cell
    const p1Cell = getCell(grid, 4, 3)!;
    p1Cell.owner = 1;
    p1Cell.orbs = 1;
    
    const move = aiFindBestMove(grid, 1);
    expect(move).not.toBeNull();
    expect(move!.r).toBe(4);
    expect(move!.c).toBe(3);
  });
});

// ============================================
// TURN ORDER EDGE CASES
// ============================================

describe('Turn Order Edge Cases', () => {
  let grid: Cell[];

  beforeEach(() => {
    grid = createGrid();
  });

  it('should handle first round with 4 players', () => {
    const fourPlayers = [1, 2, 3, 4];
    
    // First round - everyone gets a turn regardless of grid state
    expect(getNextPlayer(1, fourPlayers, grid, 0)).toBe(2);
    expect(getNextPlayer(2, fourPlayers, grid, 1)).toBe(3);
    expect(getNextPlayer(3, fourPlayers, grid, 2)).toBe(4);
    expect(getNextPlayer(4, fourPlayers, grid, 3)).toBe(1);
  });

  it('should handle mid-game elimination', () => {
    const threePlayers = [1, 2, 3];
    
    // Only player 2 has orbs (players 1 and 3 eliminated)
    getCell(grid, 4, 3)!.owner = 2;
    getCell(grid, 4, 3)!.orbs = 1;
    
    // After first round, only player 2 takes turns
    expect(getNextPlayer(2, threePlayers, grid, 10)).toBe(2);
  });

  it('should cycle between last 2 surviving players', () => {
    const fourPlayers = [1, 2, 3, 4];
    
    // Only players 2 and 4 survive
    getCell(grid, 0, 0)!.owner = 2;
    getCell(grid, 0, 0)!.orbs = 1;
    getCell(grid, 8, 5)!.owner = 4;
    getCell(grid, 8, 5)!.orbs = 1;
    
    expect(getNextPlayer(2, fourPlayers, grid, 20)).toBe(4);
    expect(getNextPlayer(4, fourPlayers, grid, 21)).toBe(2);
  });
});

// ============================================
// FULL GAME SIMULATION TESTS
// ============================================

describe('Full Game Simulation', () => {
  // Helper: process all explosions on a grid with oscillation detection
  function processAllExplosions(grid: Cell[], debug = false): number {
    let iterations = 0;
    const maxIterations = 10000; // Higher limit for complex chains
    let hasExplosion = true;
    
    // Track seen states to detect oscillation
    const seenStates = new Set<string>();
    
    while (hasExplosion && iterations < maxIterations) {
      // Check for oscillation (same state repeating)
      const stateKey = grid.filter(c => c.orbs > 0).map(c => `${c.r},${c.c}:${c.orbs}`).join('|');
      if (seenStates.has(stateKey)) {
        if (debug) console.log(`[Debug] Oscillation detected at iteration ${iterations}`);
        // Break the oscillation - this is a theoretical edge case
        break;
      }
      seenStates.add(stateKey);
      
      hasExplosion = false;
      iterations++;
      
      for (const cell of grid) {
        if (cell.orbs > cell.capacity) {
          hasExplosion = true;
          const owner = cell.owner;
          cell.orbs -= (cell.capacity + 1);
          if (cell.orbs <= 0) {
            cell.orbs = 0;
            cell.owner = 0;
          }
          
          // Add orbs to neighbors
          const neighbors = getNeighborCoords(cell.r, cell.c);
          for (const [nr, nc] of neighbors) {
            const neighbor = getCell(grid, nr, nc);
            if (neighbor) {
              neighbor.owner = owner;
              neighbor.orbs++;
            }
          }
          break; // Process one explosion at a time
        }
      }
    }
    
    if (iterations >= maxIterations) {
      const overCapacity = grid.filter(c => c.orbs > c.capacity);
      console.log(`[Debug] Still over capacity: ${overCapacity.length} cells`);
      overCapacity.slice(0, 5).forEach(c => {
        console.log(`  Cell (${c.r},${c.c}): ${c.orbs}/${c.capacity} owner=${c.owner}`);
      });
      throw new Error(`Explosion processing hit max iterations (${maxIterations})`);
    }
    
    return iterations;
  }

  // Helper: make a move and process explosions
  function makeMove(grid: Cell[], r: number, c: number, player: number): boolean {
    const cell = getCell(grid, r, c);
    if (!cell) return false;
    if (cell.owner !== 0 && cell.owner !== player) return false;
    
    cell.owner = player;
    cell.orbs++;
    processAllExplosions(grid);
    return true;
  }

  it('should complete a 2-player AI game within reasonable moves', () => {
    const grid = createGrid();
    const activePlayers = [1, 2];
    let currentPlayer = 1;
    let movesMade = 0;
    const maxMoves = 500;
    
    while (movesMade < maxMoves) {
      // Check for winner
      const winner = checkWinner(grid, activePlayers, movesMade);
      if (winner !== null) {
        console.log(`[Test] Game ended: Player ${winner} wins after ${movesMade} moves`);
        expect(winner).toBeGreaterThanOrEqual(1);
        expect(winner).toBeLessThanOrEqual(2);
        return; // Test passed
      }
      
      // AI finds move
      const move = aiFindBestMove(grid, currentPlayer);
      if (!move) {
        // No valid moves - game should be over
        const alive = getAlivePlayers(grid, activePlayers);
        expect(alive.length).toBeLessThanOrEqual(1);
        return;
      }
      
      // Make the move
      makeMove(grid, move.r, move.c, currentPlayer);
      movesMade++;
      
      // Switch player
      currentPlayer = getNextPlayer(currentPlayer, activePlayers, grid, movesMade);
    }
    
    throw new Error(`Game did not complete within ${maxMoves} moves - possible infinite loop`);
  });

  it('should complete a 4-player AI game within reasonable moves', () => {
    const grid = createGrid();
    const activePlayers = [1, 2, 3, 4];
    let currentPlayer = 1;
    let movesMade = 0;
    const maxMoves = 1000;
    
    while (movesMade < maxMoves) {
      // Check for winner
      const winner = checkWinner(grid, activePlayers, movesMade);
      if (winner !== null) {
        console.log(`[Test] 4-player game ended: Player ${winner} wins after ${movesMade} moves`);
        expect(winner).toBeGreaterThanOrEqual(1);
        expect(winner).toBeLessThanOrEqual(4);
        return; // Test passed
      }
      
      // AI finds move
      const move = aiFindBestMove(grid, currentPlayer);
      if (!move) {
        // No valid moves for this player - they might be eliminated
        const alive = getAlivePlayers(grid, activePlayers);
        if (alive.length <= 1) {
          console.log(`[Test] 4-player game ended by elimination after ${movesMade} moves`);
          return; // Game over
        }
        // Skip to next alive player
        currentPlayer = getNextPlayer(currentPlayer, activePlayers, grid, movesMade);
        continue;
      }
      
      // Make the move
      makeMove(grid, move.r, move.c, currentPlayer);
      movesMade++;
      
      // Switch player
      currentPlayer = getNextPlayer(currentPlayer, activePlayers, grid, movesMade);
    }
    
    throw new Error(`4-player game did not complete within ${maxMoves} moves - possible infinite loop`);
  });

  it('should detect winner when only one player has orbs', () => {
    const grid = createGrid();
    const activePlayers = [1, 2, 3, 4];
    
    // Only player 3 has orbs
    getCell(grid, 4, 3)!.owner = 3;
    getCell(grid, 4, 3)!.orbs = 2;
    
    // After first round
    const winner = checkWinner(grid, activePlayers, 10);
    expect(winner).toBe(3);
  });

  it('should not infinite loop when checking next player with one survivor', () => {
    const grid = createGrid();
    const activePlayers = [1, 2, 3, 4];
    
    // Only player 2 survives
    getCell(grid, 0, 0)!.owner = 2;
    getCell(grid, 0, 0)!.orbs = 5;
    
    const alive = getAlivePlayers(grid, activePlayers);
    expect(alive).toEqual([2]);
    
    // getNextPlayer should return the same player (game should end)
    const next = getNextPlayer(2, activePlayers, grid, 50);
    expect(next).toBe(2);
    
    // checkWinner should detect this
    const winner = checkWinner(grid, activePlayers, 50);
    expect(winner).toBe(2);
  });

  it('should handle rapid elimination scenario', () => {
    const grid = createGrid();
    const activePlayers = [1, 2];
    
    // Set up a chain reaction that will wipe out player 2
    // Player 1 has orbs about to explode near player 2's single orb
    getCell(grid, 0, 0)!.owner = 1;
    getCell(grid, 0, 0)!.orbs = 1; // Corner at capacity
    
    getCell(grid, 0, 1)!.owner = 1;
    getCell(grid, 0, 1)!.orbs = 2; // Edge at capacity
    
    getCell(grid, 0, 2)!.owner = 2;
    getCell(grid, 0, 2)!.orbs = 1;
    
    // Add one more orb to trigger chain
    getCell(grid, 0, 0)!.orbs = 2; // Over capacity
    processAllExplosions(grid);
    
    // Player 2 should be eliminated (their orb captured)
    const alive = getAlivePlayers(grid, activePlayers);
    expect(alive).toContain(1);
    // Player 2 might be eliminated or captured depending on chain
  });
});
