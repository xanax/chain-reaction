import { useEffect, useRef, useState, useCallback } from 'react';

export interface GamepadState {
  connected: boolean;
  index: number;
  id: string;
  axes: readonly number[];
  buttons: readonly GamepadButton[];
}

export interface UseGamepadsResult {
  gamepads: GamepadState[];
  getGamepad: (index: number) => GamepadState | undefined;
}

export function useGamepads(): UseGamepadsResult {
  const [gamepads, setGamepads] = useState<GamepadState[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const prevCountRef = useRef<number>(0);

  const updateGamepads = useCallback(() => {
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    const newGamepads: GamepadState[] = [];

    for (let i = 0; i < gps.length; i++) {
      const gp = gps[i];
      if (gp) {
        newGamepads.push({
          connected: true,
          index: gp.index,
          id: gp.id,
          axes: [...gp.axes],
          buttons: [...gp.buttons],
        });
      }
    }

    // Always update state so button/axis changes propagate
    setGamepads(newGamepads);

    animFrameRef.current = requestAnimationFrame(updateGamepads);
  }, []);

  useEffect(() => {
    const handleConnect = (e: GamepadEvent) => {
      console.log('[Gamepad] CONNECTED event:', e.gamepad.id, 'index:', e.gamepad.index);
      // Immediate update - controller available
      updateGamepads();
    };
    const handleDisconnect = (e: GamepadEvent) => {
      console.log('[Gamepad] DISCONNECTED event:', e.gamepad.id, 'index:', e.gamepad.index);
      // Keep polling - controller may reconnect with same index
      // Force immediate update
      prevCountRef.current = -1;
      updateGamepads();
    };

    window.addEventListener('gamepadconnected', handleConnect);
    window.addEventListener('gamepaddisconnected', handleDisconnect);

    console.log('[Gamepad] Starting gamepad polling...');
    animFrameRef.current = requestAnimationFrame(updateGamepads);

    return () => {
      window.removeEventListener('gamepadconnected', handleConnect);
      window.removeEventListener('gamepaddisconnected', handleDisconnect);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [updateGamepads]);

  const getGamepad = useCallback(
    (index: number) => gamepads.find(gp => gp.index === index),
    [gamepads]
  );

  return { gamepads, getGamepad };
}

// Button indices for standard gamepad layout
export const GAMEPAD_BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

export const GAMEPAD_AXES = {
  LEFT_X: 0,
  LEFT_Y: 1,
  RIGHT_X: 2,
  RIGHT_Y: 3,
};

export function isButtonPressed(gamepad: GamepadState | undefined, buttonIndex: number): boolean {
  if (!gamepad) return false;
  const button = gamepad.buttons[buttonIndex];
  return button ? button.pressed : false;
}

export function getAxisValue(gamepad: GamepadState | undefined, axisIndex: number): number {
  if (!gamepad) return 0;
  return gamepad.axes[axisIndex] ?? 0;
}

// Hook for tracking button press events (edge detection)
export function useGamepadButtons(
  gamepad: GamepadState | undefined,
  onButtonPress: (buttonIndex: number) => void
) {
  const prevButtonsRef = useRef<boolean[]>([]);

  useEffect(() => {
    if (!gamepad) return;

    const currentButtons = gamepad.buttons.map(b => b.pressed);
    const prevButtons = prevButtonsRef.current;

    for (let i = 0; i < currentButtons.length; i++) {
      // Detect rising edge (was not pressed, now pressed)
      if (currentButtons[i] && !prevButtons[i]) {
        onButtonPress(i);
      }
    }

    prevButtonsRef.current = currentButtons;
  }, [gamepad, onButtonPress]);
}

// Hook for D-pad navigation with repeat
export function useGamepadNavigation(
  gamepad: GamepadState | undefined,
  onNavigate: (dx: number, dy: number) => void,
  repeatDelay = 200,
  initialDelay = 400
) {
  const lastMoveRef = useRef<{ dx: number; dy: number; time: number } | null>(null);
  const initialMoveRef = useRef<boolean>(false);

  useEffect(() => {
    if (!gamepad) return;

    let dx = 0;
    let dy = 0;

    // D-pad
    if (isButtonPressed(gamepad, GAMEPAD_BUTTONS.DPAD_UP)) dy = -1;
    if (isButtonPressed(gamepad, GAMEPAD_BUTTONS.DPAD_DOWN)) dy = 1;
    if (isButtonPressed(gamepad, GAMEPAD_BUTTONS.DPAD_LEFT)) dx = -1;
    if (isButtonPressed(gamepad, GAMEPAD_BUTTONS.DPAD_RIGHT)) dx = 1;

    // Left stick with deadzone
    const leftX = getAxisValue(gamepad, GAMEPAD_AXES.LEFT_X);
    const leftY = getAxisValue(gamepad, GAMEPAD_AXES.LEFT_Y);
    const deadzone = 0.5;

    if (Math.abs(leftX) > deadzone) {
      dx = leftX > 0 ? 1 : -1;
    }
    if (Math.abs(leftY) > deadzone) {
      dy = leftY > 0 ? 1 : -1;
    }

    const now = Date.now();
    const last = lastMoveRef.current;

    if (dx === 0 && dy === 0) {
      lastMoveRef.current = null;
      initialMoveRef.current = false;
      return;
    }

    if (!last || last.dx !== dx || last.dy !== dy) {
      // New direction
      onNavigate(dx, dy);
      lastMoveRef.current = { dx, dy, time: now };
      initialMoveRef.current = false;
    } else {
      // Same direction, check for repeat
      const delay = initialMoveRef.current ? repeatDelay : initialDelay;
      if (now - last.time >= delay) {
        onNavigate(dx, dy);
        lastMoveRef.current = { dx, dy, time: now };
        initialMoveRef.current = true;
      }
    }
  }, [gamepad, onNavigate, repeatDelay, initialDelay]);
}
