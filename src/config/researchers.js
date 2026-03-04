/**
 * Curated list of top AI researchers to monitor for affiliation changes.
 * Used by talent-adapter.js to detect lab movements.
 *
 * Fields:
 *  - name: Human-readable name
 *  - arxivQuery: ArXiv search query for this author (au:"Last First" format)
 *  - github: GitHub username (null if not tracked)
 *  - currentAffil: Known current affiliation (compared against new papers)
 *  - keywords: Additional keywords to help match affiliation strings
 */

const RESEARCHERS = [
  // OpenAI / Ex-OpenAI
  { name: 'Ilya Sutskever', arxivQuery: 'au:"Sutskever Ilya"', github: null, currentAffil: 'SSI', keywords: ['safe superintelligence'] },
  { name: 'Andrej Karpathy', arxivQuery: 'au:"Karpathy Andrej"', github: 'karpathy', currentAffil: 'Independent', keywords: ['eureka labs'] },
  { name: 'Alec Radford', arxivQuery: 'au:"Radford Alec"', github: null, currentAffil: 'OpenAI', keywords: ['openai'] },
  { name: 'John Schulman', arxivQuery: 'au:"Schulman John"', github: null, currentAffil: 'Anthropic', keywords: ['anthropic'] },
  { name: 'Jakub Pachocki', arxivQuery: 'au:"Pachocki Jakub"', github: null, currentAffil: 'OpenAI', keywords: ['openai'] },
  { name: 'Szymon Sidor', arxivQuery: 'au:"Sidor Szymon"', github: null, currentAffil: 'OpenAI', keywords: ['openai'] },

  // Anthropic
  { name: 'Dario Amodei', arxivQuery: 'au:"Amodei Dario"', github: null, currentAffil: 'Anthropic', keywords: ['anthropic'] },
  { name: 'Chris Olah', arxivQuery: 'au:"Olah Chris"', github: 'colah', currentAffil: 'Anthropic', keywords: ['anthropic'] },
  { name: 'Tom Brown', arxivQuery: 'au:"Brown Tom"', github: null, currentAffil: 'Anthropic', keywords: ['anthropic'] },

  // Google DeepMind
  { name: 'Jeff Dean', arxivQuery: 'au:"Dean Jeff"', github: null, currentAffil: 'Google DeepMind', keywords: ['google', 'deepmind'] },
  { name: 'Noam Shazeer', arxivQuery: 'au:"Shazeer Noam"', github: null, currentAffil: 'Google DeepMind', keywords: ['google', 'character.ai'] },
  { name: 'Geoffrey Hinton', arxivQuery: 'au:"Hinton Geoffrey"', github: null, currentAffil: 'Independent', keywords: ['university of toronto'] },
  { name: 'Demis Hassabis', arxivQuery: 'au:"Hassabis Demis"', github: null, currentAffil: 'Google DeepMind', keywords: ['deepmind'] },

  // Meta AI
  { name: 'Yann LeCun', arxivQuery: 'au:"LeCun Yann"', github: null, currentAffil: 'Meta', keywords: ['meta', 'fair', 'nyu'] },
  { name: 'Hugo Touvron', arxivQuery: 'au:"Touvron Hugo"', github: null, currentAffil: 'Meta', keywords: ['meta', 'fair'] },

  // Chinese AI Labs
  { name: 'Wenda Li', arxivQuery: 'au:"Li Wenda"', github: null, currentAffil: 'DeepSeek', keywords: ['deepseek'] },
  { name: 'Damai Dai', arxivQuery: 'au:"Dai Damai"', github: null, currentAffil: 'DeepSeek', keywords: ['deepseek'] },
  { name: 'Junyang Lin', arxivQuery: 'au:"Lin Junyang"', github: null, currentAffil: 'Alibaba', keywords: ['alibaba', 'qwen', 'damo'] },
  { name: 'Zhengxiao Du', arxivQuery: 'au:"Du Zhengxiao"', github: null, currentAffil: 'Zhipu AI', keywords: ['zhipu', 'tsinghua', 'thudm'] },

  // xAI
  { name: 'Igor Babuschkin', arxivQuery: 'au:"Babuschkin Igor"', github: null, currentAffil: 'xAI', keywords: ['xai', 'x.ai'] },

  // Mistral
  { name: 'Arthur Mensch', arxivQuery: 'au:"Mensch Arthur"', github: null, currentAffil: 'Mistral', keywords: ['mistral'] },
  { name: 'Guillaume Lample', arxivQuery: 'au:"Lample Guillaume"', github: null, currentAffil: 'Mistral', keywords: ['mistral'] },

  // Cohere
  { name: 'Aidan Gomez', arxivQuery: 'au:"Gomez Aidan"', github: null, currentAffil: 'Cohere', keywords: ['cohere'] },

  // Notable independents / startup founders
  { name: 'Yi Tay', arxivQuery: 'au:"Tay Yi"', github: null, currentAffil: 'Reka', keywords: ['reka'] },
  { name: 'Tri Dao', arxivQuery: 'au:"Dao Tri"', github: 'tridao', currentAffil: 'Together AI', keywords: ['together', 'princeton'] },
];

// Lab affiliation patterns — used to parse affiliation strings from ArXiv
const AFFILIATION_PATTERNS = {
  'OpenAI': /openai/i,
  'Anthropic': /anthropic/i,
  'Google DeepMind': /google|deepmind/i,
  'Meta': /meta\s?(ai|fair|research)|facebook/i,
  'Mistral': /mistral/i,
  'xAI': /\bxai\b|x\.ai/i,
  'DeepSeek': /deepseek/i,
  'Alibaba': /alibaba|damo|qwen/i,
  'Zhipu AI': /zhipu|tsinghua|thudm/i,
  'Cohere': /cohere/i,
  'Microsoft': /microsoft/i,
  'NVIDIA': /nvidia/i,
  'Apple': /apple/i,
  'Amazon': /amazon|aws/i,
  'Stability AI': /stability\s?ai/i,
  'Together AI': /together\s?ai/i,
  'Reka': /\breka\b/i,
  'Character.AI': /character\.?ai/i,
  'SSI': /safe\s?superintelligence|ssi/i,
};

module.exports = {
  RESEARCHERS,
  AFFILIATION_PATTERNS,
};
