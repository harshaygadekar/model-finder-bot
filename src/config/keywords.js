/**
 * Keyword-based relevance filtering configuration.
 * Used to determine if a Reddit post or news article is about an AI model release.
 */

// High-signal keywords — strong indicator of a model release
const RELEASE_KEYWORDS = [
  'release', 'released', 'releasing',
  'launch', 'launched', 'launching',
  'announce', 'announced', 'announcing', 'announcement',
  'introducing', 'introduces', 'introduced',
  'unveil', 'unveiled', 'unveiling',
  'open source', 'open-source', 'opensourced', 'open sourced',
  'now available', 'is available', 'are available',
  'weights released', 'model weights',
  'new model', 'new version',
  'checkpoint', 'checkpoints',
  // Hardware / product launches relevant to AI ecosystem
  'new product', 'product launch',
  'new chip', 'new processor', 'new gpu',
  'apple intelligence', 'neural engine',
  'apple silicon', 'macbook pro', 'mac studio',
];

// Model-related terms — moderate signal
const MODEL_KEYWORDS = [
  'llm', 'large language model',
  'foundation model',
  'multimodal', 'vision language',
  'text-to-image', 'text-to-video', 'text-to-speech',
  'image generation', 'video generation',
  'embedding model', 'embeddings',
  'fine-tune', 'fine-tuned', 'finetuned',
  'instruction tuned', 'instruction-tuned',
  'rlhf', 'dpo', 'grpo',
  'transformer', 'diffusion',
  'gguf', 'ggml', 'gptq', 'awq', 'exl2',
  'quantized', 'quantization',
  'api access', 'api launch',
];

// Known model name patterns (regex-friendly)
const MODEL_NAME_PATTERNS = [
  /gpt[-\s]?\d/i,
  /claude[-\s]?\d/i,
  /gemini[-\s]?\d?/i,
  /llama[-\s]?\d/i,
  /mistral[-\s]?\w/i,
  /mixtral/i,
  /deepseek[-\s]?[vr]?\d/i,
  /qwen[-\s]?\d/i,
  /phi[-\s]?\d/i,
  /glm[-\s]?\d/i,
  /yi[-\s]?\d/i,
  /gemma[-\s]?\d/i,
  /command[-\s]?r/i,
  /stable\s?diffusion/i,
  /dall[-\s]?e/i,
  /sora/i,
  /flux/i,
  /whisper/i,
  /codestral/i,
  /grok[-\s]?\d/i,
  /o[134][-\s]?(mini|preview|pro)?/i,
  /ernie/i,
  /doubao/i,
  /kimi/i,
];

// Chinese model-specific patterns — extended coverage for eastern ecosystem
const CHINESE_MODEL_PATTERNS = [
  /deepseek[-\s]?(v\d|coder|chat|moe|r1|r2|prover)/i,
  /qwen[-\s]?\d*\.?\d*([-\s]?(chat|coder|vl|audio|math|turbo))?/i,
  /yi[-\s]?(34b|6b|9b|lightning|large|vision|coder)/i,
  /glm[-\s]?\d+([-\s]?(chat|code|vision))?/i,
  /minimax[-\s]?(abab|text|speech)/i,
  /baichuan[-\s]?\d+/i,
  /internlm[-\s]?\d+([-\s]?(chat|math))?/i,
  /internvl[-\s]?\d*/i,
  /cogvlm[-\s]?\d*/i,
  /cogvideo/i,
  /step[-\s]?\d/i,           // StepFun models
  /megrez/i,                  // Infinigence models
  /abab[-\s]?\d/i,           // MiniMax models
  /skywork/i,                 // Kunlun Tech models
  /hunyuan/i,                 // Tencent models
  /kimi[-\s]?(k\d|chat|vision)?/i,  // Moonshot Kimi models
  /doubao/i,                  // ByteDance Doubao models
];

// Lab/company names — used to boost relevance when combined with other keywords
const LAB_NAMES = [
  'openai', 'anthropic', 'google', 'deepmind', 'meta', 'facebook',
  'mistral', 'cohere', 'stability', 'stabilityai',
  'xai', 'x.ai', 'grok',
  'deepseek', 'alibaba', 'qwen',
  'zhipu', 'chatglm', 'glm',
  'moonshot', 'kimi',
  'minimax', 'abab',
  'stepfun', 'z.ai',
  'baidu', 'ernie',
  '01.ai', '01ai', 'yi',
  'bytedance', 'doubao',
  'nvidia', 'microsoft', 'apple',
  'hugging face', 'huggingface',
];

// Words that reduce relevance (likely not a model release)
const NEGATIVE_KEYWORDS = [
  'hiring', 'job opening', 'career',
  'fundraising', 'valuation', 'ipo',
  'lawsuit', 'sued', 'regulation',
  'opinion', 'editorial',
  'meme', 'funny',
  'eli5', 'explain like',
];

/**
 * Calculate relevance score for a text (title + description).
 * @param {string} text - Combined title and description
 * @returns {{ score: number, matches: string[] }} - Score 0-1 and matched keywords
 */
function calculateRelevance(text) {
  const lower = text.toLowerCase();
  const matches = [];
  let score = 0;

  // Check negative keywords first (reduce score)
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) {
      score -= 0.3;
      matches.push(`-${kw}`);
    }
  }

  // Check release keywords (high weight)
  for (const kw of RELEASE_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 0.3;
      matches.push(kw);
    }
  }

  // Check model keywords (medium weight)
  for (const kw of MODEL_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 0.15;
      matches.push(kw);
    }
  }

  // Check model name patterns (high weight)
  for (const pattern of MODEL_NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      score += 0.35;
      matches.push(match[0]);
    }
  }

  // Check Chinese model patterns (high weight)
  for (const pattern of CHINESE_MODEL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      score += 0.35;
      matches.push(match[0]);
    }
  }

  // Check lab names (medium weight when combined)
  for (const lab of LAB_NAMES) {
    if (lower.includes(lab)) {
      score += 0.1;
      matches.push(lab);
    }
  }

  // Cap at 1.0
  return {
    score: Math.max(0, Math.min(1, score)),
    matches: [...new Set(matches)],
  };
}

// Minimum relevance score for Reddit posts to be notified
const RELEVANCE_THRESHOLD = 0.3;

module.exports = {
  RELEASE_KEYWORDS,
  MODEL_KEYWORDS,
  MODEL_NAME_PATTERNS,
  CHINESE_MODEL_PATTERNS,
  LAB_NAMES,
  NEGATIVE_KEYWORDS,
  calculateRelevance,
  RELEVANCE_THRESHOLD,
};
