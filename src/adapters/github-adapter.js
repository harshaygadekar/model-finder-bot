const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

class GitHubAdapter extends BaseAdapter {
  /**
   * @param {Object} source - Source config
   * @param {string} source.org - GitHub org name
   * @param {string[]} source.repos - Repo names to monitor
   * @param {number} source.priority - Priority level
   */
  constructor(source) {
    super(`GitHub: ${source.org}`, 'github', source.priority);
    this.org = source.org;
    this.repos = source.repos;
    this.token = process.env.GITHUB_TOKEN || '';
  }

  async check() {
    const allItems = [];

    for (const repo of this.repos) {
      try {
        const items = await this._checkRepo(this.org, repo);
        allItems.push(...items);
      } catch (error) {
        // Log but don't fail the whole adapter for one repo
        if (error.response?.status === 404) {
          logger.debug(`[GitHub] ${this.org}/${repo} not found (may not exist yet)`);
        } else {
          logger.warn(`[GitHub] ${this.org}/${repo} error: ${error.message}`);
        }
      }
    }

    return allItems;
  }

  async _checkRepo(org, repo) {
    const headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ModelLookerBot/1.0',
    };
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }

    const response = await http.get(
      `https://api.github.com/repos/${org}/${repo}/releases`,
      {
        headers,
        params: { per_page: 5 },
        timeout: 15000,
      }
    );

    return (response.data || []).map((release) => ({
      title: `${org}/${repo}: ${release.name || release.tag_name}`,
      description: truncate(release.body || '', 500),
      url: release.html_url,
      sourceName: `GitHub: ${org}/${repo}`,
      sourceType: 'github',
      priority: this.priority,
      tags: ['github', 'release', release.prerelease ? 'pre-release' : 'stable'],
      publishedAt: new Date(release.published_at || release.created_at),
    }));
  }
}

function truncate(str, maxLen) {
  if (!str) return '';
  // Strip markdown links and images for cleaner descriptions
  const cleaned = str.replace(/!\[.*?\]\(.*?\)/g, '').replace(/\[([^\]]+)\]\(.*?\)/g, '$1');
  return cleaned.length > maxLen ? cleaned.substring(0, maxLen - 3) + '...' : cleaned;
}

module.exports = GitHubAdapter;
