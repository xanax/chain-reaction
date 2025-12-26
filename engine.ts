// Game engine types and logic for Chain Reaction

export const GRID_ROWS = 9;
export const GRID_COLS = 6;

export type CellType = 'corner' | 'edge' | 'center';

export interface Cell {
  r: number;
  c: number;
  orbs: number;
  owner: number; // 0 = empty, 1-4 = players
  capacity: number;
  neighborCount: number;
  type: CellType;
  pulsePhase: number;
}

export type PlayerType = 'human' | 'ai' | 'off';

export interface PlayerConfig {
  type: PlayerType;
  controllerId: number | null; // Gamepad index, null for keyboard/mouse
}

export interface GameState {
  grid: Cell[];
  currentPlayer: number;
  movesMade: number;
  gameActive: boolean;
  winner: number | null;
  playerConfigs: PlayerConfig[];
  activePlayers: number[]; // Which player numbers are in the game
}

export const PLAYER_COLORS = {
  1: { primary: '#ff3366', secondary: '#ff6b6b', glow: 'rgba(255, 51, 102, 0.8)' },
  2: { primary: '#00d4ff', secondary: '#4facfe', glow: 'rgba(0, 212, 255, 0.8)' },
  3: { primary: '#10b981', secondary: '#34d399', glow: 'rgba(16, 185, 129, 0.8)' },
  4: { primary: '#f59e0b', secondary: '#fbbf24', glow: 'rgba(245, 158, 11, 0.8)' },
} as const;

export const PLAYER_NAMES = ['', 'RED', 'CYAN', 'GREEN', 'GOLD'];

export const CELL_COLORS = {
  corner: { fill: '#1a1a2e', stroke: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.3)' },
  edge: { fill: '#16213e', stroke: '#3b82f6', glow: 'rgba(59, 130, 246, 0.25)' },
  center: { fill: '#0f172a', stroke: '#14b8a6', glow: 'rgba(20, 184, 166, 0.2)' },
};

export function createCell(r: number, c: number): Cell {
  let neighbors = 0;
  if (r > 0) neighbors++;
  if (r < GRID_ROWS - 1) neighbors++;
  if (c > 0) neighbors++;
  if (c < GRID_COLS - 1) neighbors++;
  
  const capacity = neighbors - 1;
  
  let type: CellType;
  if (neighbors === 2) {
    type = 'corner';
  } else if (neighbors === 3) {
    type = 'edge';
  } else {
    type = 'center';
  }
  
  return {
    r,
    c,
    orbs: 0,
    owner: 0,
    capacity,
    neighborCount: neighbors,
    type,
    pulsePhase: Math.random() * Math.PI * 2,
  };
}

export function createGrid(): Cell[] {
  const grid: Cell[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      grid.push(createCell(r, c));
    }
  }
  return grid;
}

export function getCell(grid: Cell[], r: number, c: number): Cell | null {
  if (r < 0 || c < 0 || r >= GRID_ROWS || c >= GRID_COLS) return null;
  return grid[r * GRID_COLS + c];
}

export function validateMove(grid: Cell[], r: number, c: number, player: number): boolean {
  const cell = getCell(grid, r, c);
  if (!cell) return false;
  if (cell.owner !== 0 && cell.owner !== player) return false;
  return true;
}

export function getNeighborCoords(r: number, c: number): [number, number][] {
  const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  return dirs
    .map(([dr, dc]) => [r + dr, c + dc] as [number, number])
    .filter(([nr, nc]) => nr >= 0 && nc >= 0 && nr < GRID_ROWS && nc < GRID_COLS);
}

export function getAlivePlayers(grid: Cell[], activePlayers: number[]): number[] {
  const owners = new Set(grid.filter(c => c.orbs > 0).map(c => c.owner));
  return activePlayers.filter(p => owners.has(p));
}

export function checkWinner(
  grid: Cell[],
  activePlayers: number[],
  movesMade: number
): number | null {
  if (movesMade < activePlayers.length) return null;
  
  const alive = getAlivePlayers(grid, activePlayers);
  if (alive.length === 1) {
    return alive[0];
  }
  // Edge case: if no one has orbs but game continued, find who made the last move
  if (alive.length === 0) {
    // Return first active player as winner (shouldn't normally happen)
    return activePlayers[0];
  }
  return null;
}

export function getNextPlayer(
  currentPlayer: number,
  activePlayers: number[],
  grid: Cell[],
  movesMade: number
): number {
  if (movesMade < activePlayers.length) {
    // First round: everyone gets a turn
    const idx = activePlayers.indexOf(currentPlayer);
    return activePlayers[(idx + 1) % activePlayers.length];
  }
  
  const alive = getAlivePlayers(grid, activePlayers);
  if (alive.length <= 1) return currentPlayer;
  
  const idx = alive.indexOf(currentPlayer);
  return alive[(idx + 1) % alive.length];
}

// AI Logic
export function aiScoreMove(grid: Cell[], cell: Cell, player: number): number {
  let score = 0;

  // Prefer cells we already own
  if (cell.owner === player) {
    score += 10;
  }

  // Prefer cells close to exploding
  if (cell.orbs === cell.capacity) {
    score += 25;
  } else if (cell.orbs === cell.capacity - 1) {
    score += 15;
  }

  // Prefer corners and edges
  if (cell.type === 'corner') {
    score += 8;
  } else if (cell.type === 'edge') {
    score += 4;
  }

  // Check neighbors
  const neighbors = getNeighborCoords(cell.r, cell.c);
  for (const [nr, nc] of neighbors) {
    const neighbor = getCell(grid, nr, nc);
    if (neighbor) {
      // Attack opportunities
      if (neighbor.owner !== 0 && neighbor.owner !== player && neighbor.orbs > 0) {
        score += 5;
        if (cell.orbs === cell.capacity) {
          score += 10;
        }
      }
      // Enemy about to explode into us
      if (neighbor.owner !== 0 && neighbor.owner !== player && neighbor.orbs === neighbor.capacity) {
        score -= 8;
      }
    }
  }

  // Randomness for variety
  score += Math.random() * 3;

  return score;
}

export function aiFindBestMove(grid: Cell[], player: number): { r: number; c: number } | null {
  const validMoves: { r: number; c: number; cell: Cell }[] = [];
  
  for (const cell of grid) {
    if (cell.owner === 0 || cell.owner === player) {
      validMoves.push({ r: cell.r, c: cell.c, cell });
    }
  }

  if (validMoves.length === 0) return null;

  const scoredMoves = validMoves.map(move => ({
    ...move,
    score: aiScoreMove(grid, move.cell, player),
  }));

  scoredMoves.sort((a, b) => b.score - a.score);

  // Pick from top moves with randomness
  const topMoves = scoredMoves.slice(0, Math.min(3, scoredMoves.length));
  const chosen = topMoves[Math.floor(Math.random() * topMoves.length)];
  
  return { r: chosen.r, c: chosen.c };
}
