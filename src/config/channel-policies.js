const CHANNEL_POLICIES = {
  'major-releases': {
    purpose: 'Major official launches, flagship model upgrades, and notable tech product/software/hardware releases.',
  },
  'tech-news': {
    purpose: 'Broader technology news, company updates, reports, blogs, and analysis.',
  },
  'community-buzz': {
    purpose: 'Forum, social, community, and open-source chatter around AI and technology.',
  },
  'leaderboard-updates': {
    purpose: 'Arena, benchmark, eval, and leaderboard movement only.',
  },
  'research-papers': {
    purpose: 'Research papers and research-digest content.',
  },
  'model-updates': {
    purpose: 'Meaningful LLM and AI model changes that are important but not major-release tier.',
  },
  'rumors-leaks': {
    purpose: 'Speculative, leaked, or low-confidence signals that should stay isolated from confirmed channels.',
  },
  'china-ai': {
    purpose: 'China-specific AI and tech landscape updates when no more specific domain channel is a better primary fit.',
  },
  'major-events': {
    purpose: 'Planned event announcements, live event-related coverage, and recap-style event updates.',
  },
  'talent-moves': {
    purpose: 'Researcher and executive movement alerts.',
  },
};

const OFFICIAL_SOURCE_TYPES = new Set(['rss', 'scrape', 'changelog']);
const PLATFORM_SOURCE_TYPES = new Set(['github', 'huggingface', 'ollama', 'api-models']);
const COMMUNITY_SOURCE_TYPES = new Set(['reddit', 'bluesky', 'hackernews']);
const BENCHMARK_SOURCE_TYPES = new Set(['leaderboard', 'arena-models']);
const RESEARCH_SOURCE_TYPES = new Set(['arxiv', 'hf-papers', 'paper']);
const TALENT_SOURCE_TYPES = new Set(['talent']);
const RUMOR_SOURCE_TYPES = new Set(['sdk-tracker', 'playground-leak', 'arena-mystery']);
const CHINA_SOURCE_TYPES = new Set(['china-ai']);

const RELEASE_SIGNAL_PATTERN = /\b(?:launch(?:ed|es|ing)?|release(?:d|s)?|announc(?:e|ed|es|ement)?|introduc(?:e|ed|es|ing)|unveil(?:ed|s|ing)?|ship(?:ped|s|ping)?|now available|general availability|ga|available today)\b/i;
const MAJOR_TECH_PRODUCT_PATTERN = /\b(?:macbook|iphone|ipad|vision pro|headset|chip|gpu|processor|hardware|robot|robotics|device|software|platform|console|assistant|studio|workstation|operating system|os|developer tool|tooling)\b/i;
const MODEL_FAMILY_PATTERN = /\b(?:gpt|claude|gemini|llama|grok|qwen|deepseek|glm|chatglm|kimi|doubao|ernie|yi|mistral|mixtral|codestral|gemma|phi|command-r|dall-e|sora|flux|whisper|hunyuan|baichuan|minimax|abab)[-\s]?[a-z0-9.]+\b/i;
const OPEN_SOURCE_SIGNAL_PATTERN = /\b(?:open source|open-source|opensource|github|repo|repository|commit|release notes|pull request|checkpoint|weights|hugging ?face|hf)\b/i;
const COMMUNITY_SIGNAL_PATTERN = /\b(?:reddit|hacker news|show hn|bluesky|community|forum|thread|discussion|open source)\b/i;
const RUMOR_SIGNAL_PATTERN = /\b(?:leak(?:ed|s)?|rumou?r(?:ed|s)?|insider|unreleased|mystery model|blind test|spotted)\b/i;
const EVENT_SIGNAL_PATTERN = /\b(?:google i\/o|i\/o|wwdc|dev ?day|openai devday|build|ignite|re:invent|reinvent|keynote|summit|conference|launch week|expo|ces|neurips|iclr|icml)\b/i;
const EVENT_PLANNED_PATTERN = /\b(?:save the date|agenda|schedule|registration|register|tickets?|livestream|kicks? off|starts? on|coming on|announc(?:e|ed|es).{0,40}(?:date|agenda|schedule)|will host)\b/i;
const EVENT_RECAP_PATTERN = /\b(?:recap|wrap[- ]?up|highlights|what we announced|everything announced|key takeaways|roundup)\b/i;
const CHINA_SIGNAL_PATTERN = /\b(?:china|chinese|beijing|shanghai|shenzhen|deepseek|qwen|moonshot|kimi|doubao|baichuan|minimax|zhipu|chatglm|glm|01\.ai|yi|stepfun|hunyuan|ernie|siliconflow)\b/i;

module.exports = {
  CHANNEL_POLICIES,
  OFFICIAL_SOURCE_TYPES,
  PLATFORM_SOURCE_TYPES,
  COMMUNITY_SOURCE_TYPES,
  BENCHMARK_SOURCE_TYPES,
  RESEARCH_SOURCE_TYPES,
  TALENT_SOURCE_TYPES,
  RUMOR_SOURCE_TYPES,
  CHINA_SOURCE_TYPES,
  RELEASE_SIGNAL_PATTERN,
  MAJOR_TECH_PRODUCT_PATTERN,
  MODEL_FAMILY_PATTERN,
  OPEN_SOURCE_SIGNAL_PATTERN,
  COMMUNITY_SIGNAL_PATTERN,
  RUMOR_SIGNAL_PATTERN,
  EVENT_SIGNAL_PATTERN,
  EVENT_PLANNED_PATTERN,
  EVENT_RECAP_PATTERN,
  CHINA_SIGNAL_PATTERN,
};