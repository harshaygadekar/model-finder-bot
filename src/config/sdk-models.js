/**
 * Known and suspected model name patterns for SDK supply chain monitoring.
 * Used by sdk-tracker-adapter.js to detect unreleased model names in SDK source code.
 */

// Patterns to search for in SDK package source/typings
// These are regexes applied against the raw package source
const MODEL_SEARCH_PATTERNS = [
  // OpenAI patterns
  /gpt-4\.5[\w-]*/gi,
  /gpt-5[\w-]*/gi,
  /o[2-9](-mini|-preview|-pro)?/gi,
  /o[2-9][\w-]*/gi,
  /dall-e-4[\w-]*/gi,
  /gpt-4o-([\w-]+)/gi,

  // Anthropic patterns
  /claude-4[\w.-]*/gi,
  /claude-3[\w.-]*/gi,
  /claude-opus[\w.-]*/gi,
  /claude-sonnet[\w.-]*/gi,
  /claude-haiku[\w.-]*/gi,

  // Generic new model patterns
  /model[_-]?\d{4}[\w-]*/gi,
];

// Models we already know about — exclude from "leak" alerts
// Update this list as new models are officially announced
const KNOWN_MODELS = new Set([
  // OpenAI
  'gpt-4', 'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4o', 'gpt-4o-mini',
  'gpt-4o-audio-preview', 'gpt-4o-realtime-preview',
  'gpt-4-0125-preview', 'gpt-4-1106-preview', 'gpt-4-vision-preview',
  'gpt-3.5-turbo', 'gpt-3.5-turbo-16k', 'gpt-3.5-turbo-instruct',
  'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini',
  'dall-e-2', 'dall-e-3',
  'tts-1', 'tts-1-hd', 'whisper-1',
  'text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002',
  'chatgpt-4o-latest',
  'gpt-4.5-preview',
  'gpt-image-1',

  // Anthropic
  'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307',
  'claude-3-5-sonnet-20240620', 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
  'claude-2.1', 'claude-2.0', 'claude-instant-1.2',
]);

// Files/paths within the package to inspect for model names
const SDK_INSPECT_PATHS = {
  openai: [
    'dist/resources/chat/completions.d.ts',
    'dist/resources/models.d.ts',
    'resources/chat/completions.py',
    'resources/models.py',
    'types/chat_model.py',
  ],
  anthropic: [
    'dist/resources/messages.d.ts',
    'types/model_param.py',
    'resources/messages.py',
  ],
};

module.exports = {
  MODEL_SEARCH_PATTERNS,
  KNOWN_MODELS,
  SDK_INSPECT_PATHS,
};
