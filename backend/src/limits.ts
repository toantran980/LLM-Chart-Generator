import type { DiagramType, DiagramTypeOption } from '../../shared/types';

export const MAX_TEXT_LENGTH = 15_000;
export const MAX_INSTRUCTION_LENGTH = 2_000;
export const MAX_MERMAID_LENGTH = 20_000;
export const MAX_ERROR_LENGTH = 2_000;
export const MAX_TITLE_LENGTH = 255;
export const MAX_THEME_LENGTH = 64;

export const VALID_DIAGRAM_TYPES: readonly DiagramType[] = [
  'flowchart',
  'timeline',
  'rules',
  'gantt',
  'er',
  'mindmap',
  'gitgraph',
];
export const VALID_DIAGRAM_TYPE_OPTIONS: readonly DiagramTypeOption[] = [
  'auto',
  ...VALID_DIAGRAM_TYPES,
];

export const VALID_DIRECTIONS = ['auto', 'TD', 'TB', 'LR', 'RL', 'BT'] as const;

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX = 20;
export const DEFAULT_DAILY_RATE_LIMIT_MAX = 200;
export const DEFAULT_DAILY_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
