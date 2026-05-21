// Shared types for the options page.

export type ProviderId = 'ollama' | 'local' | 'gemini';

export interface Settings {
  provider: ProviderId;
  ollamaUrl: string;
  ollamaModel: string;
  localServerUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  autoMode: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
  error?: string;
  serverReachable?: boolean;
  modelInstalled?: boolean;
  availableModels?: string[];
  details?: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'moondream:latest',
  localServerUrl: 'http://localhost:8001',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  autoMode: false,
};

export const RECOMMENDED_OLLAMA_MODELS = [
  { id: 'moondream:latest', label: 'Moondream (1.7GB)', note: 'Default. Small vision model, low RAM.' },
  { id: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B (5.9GB)', note: 'Best JP OCR + bbox, but RAM-heavy.' },
  { id: 'qwen2.5vl:3b', label: 'Qwen2.5-VL 3B', note: 'Middle ground for vision.' },
  { id: 'minicpm-v', label: 'MiniCPM-V 2.6', note: 'Alternative. Strong OCR.' },
  { id: 'llama3.2-vision', label: 'Llama 3.2 Vision', note: 'Weaker on Japanese.' },
];

export const RECOMMENDED_GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'Default. Best balance of accuracy + speed. Free 1500 req/day.' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', note: 'Faster, slightly weaker on Japanese.' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', note: 'Older, still solid on Japanese.' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', note: 'Highest accuracy, lower free quota.' },
];
