// Shared mystery / anonymous model detection heuristics.
// Used by both leaderboard monitoring and Arena model extraction.

const MYSTERY_PATTERNS = [
  /^[a-z]+-[a-z]+-[a-z]+$/,      // e.g., sus-column-r
  /^[a-z]+-[a-z]+$/,             // e.g., two-word codenames
  /^[a-z]{4,25}$/,               // e.g., galapagos
  /^im-[a-z]+-[a-z]+/,
  /^anon[-_]/i,
  /^mystery/i,
  /^model[-_]\d+$/i,
  /^[a-f0-9]{8,}$/,
  /^chatbot[-_]\d/i,
  /^test[-_]model/i,
  /^arena[-_]/i,
  /^[a-z]+\d+$/i,
];

const KNOWN_PREFIXES = [
  'gpt-', 'claude-', 'gemini-', 'llama-', 'mistral-', 'mixtral-',
  'deepseek-', 'qwen-', 'qwen2', 'qwen3', 'phi-', 'glm-', 'yi-', 'gemma-', 'command-',
  'grok-', 'palm-', 'o1-', 'o3-', 'o4-', 'cohere-', 'nvidia-',
  'meta-', 'google-', 'anthropic-', 'seed-', 'ernie-', 'kimi-',
  'step-', 'minimax-', 'doubao-', 'abab-', 'stable-', 'flux-',
  'dall-', 'whisper-', 'codestral-', 'internlm-', 'internvl-',
  'cogvlm-', 'cogvideo-', 'skywork-', 'hunyuan-', 'megrez-',
  'baichuan-', 'jamba-', 'dbrx-', 'arctic-', 'nemotron-',
  'wizardlm-', 'solar-', 'reka-', 'aya-',
];

const KNOWN_FAMILY_PATTERN = /^(gpt|claude|gemini|llama|mistral|mixtral|deepseek|qwen(?:\d+(?:\.\d+)?)?|phi|glm|yi|gemma|command|grok|palm|cohere|nvidia|meta|google|anthropic|seed|ernie|kimi|step|minimax|doubao|abab|stable|flux|dall|whisper|codestral|internlm|internvl|cogvlm|cogvideo|skywork|hunyuan|megrez|baichuan|jamba|dbrx|arctic|nemotron|wizardlm|solar|reka|aya|o[134])([\-_.\s\/]|\d|$)/i;

function isMysteryModel(modelName) {
  if (!modelName) return false;

  const lower = String(modelName).toLowerCase().trim();
  if (!lower) return false;

  if (KNOWN_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  if (KNOWN_FAMILY_PATTERN.test(lower)) return false;

  if (MYSTERY_PATTERNS.some((pattern) => pattern.test(lower))) return true;

  return lower.length >= 3 && lower.length <= 30 && /^[a-z0-9][-a-z0-9_.]*$/.test(lower);
}

module.exports = {
  MYSTERY_PATTERNS,
  KNOWN_PREFIXES,
  KNOWN_FAMILY_PATTERN,
  isMysteryModel,
};