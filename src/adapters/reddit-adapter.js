const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

class RedditAdapter extends BaseAdapter {
  /**
   * @param {Object} source - Source config
   * @param {string} source.subreddit - Subreddit name (without r/)
   * @param {number} source.priority - Priority level
   */
  constructor(source) {
    super(`Reddit: r/${source.subreddit}`, 'reddit', source.priority);
    this.subreddit = source.subreddit;
  }

  async check() {
    try {
      await this._ensureToken();
      const response = await axios.get(
        `https://oauth.reddit.com/r/${this.subreddit}/new`,
        {
          headers: {
            Authorization: `Bearer ${sharedToken}`,
            'User-Agent': process.env.REDDIT_USER_AGENT || 'ModelLookerBot/1.0',
          },
          params: { limit: 15 },
          timeout: 15000,
        }
      );

      const posts = response.data?.data?.children || [];

      return posts
        .filter((p) => !p.data.stickied) // Skip pinned posts
        .map((p) => {
          const post = p.data;
          return {
            title: post.title || 'Untitled',
            description: truncate(post.selftext || '', 300),
            url: `https://reddit.com${post.permalink}`,
            sourceName: `r/${this.subreddit}`,
            sourceType: 'reddit',
            priority: this.priority,
            tags: buildTags(post),
            publishedAt: new Date(post.created_utc * 1000),
          };
        });
    } catch (error) {
      logger.error(`[Reddit] r/${this.subreddit} error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get or refresh OAuth2 access token.
   */
  async _ensureToken() {
    if (sharedToken && Date.now() < sharedTokenExpiry) return;

    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Reddit API credentials not configured. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.');
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': process.env.REDDIT_USER_AGENT || 'ModelLookerBot/1.0',
        },
        timeout: 10000,
      }
    );

    sharedToken = response.data.access_token;
    // Refresh 60 seconds before expiry
    sharedTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
    logger.debug(`[Reddit] OAuth token refreshed, expires in ${response.data.expires_in}s`);
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function buildTags(post) {
  const tags = ['reddit'];
  if (post.link_flair_text) tags.push(post.link_flair_text);
  if (post.score > 100) tags.push('trending');
  if (post.num_comments > 50) tags.push('discussion');
  return tags;
}

// Share the token across all Reddit adapter instances
let sharedToken = null;
let sharedTokenExpiry = 0;

module.exports = RedditAdapter;
