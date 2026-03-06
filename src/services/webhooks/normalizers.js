function truncate(str, maxLen) {
  if (!str) return '';
  const cleaned = String(str)
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1');
  return cleaned.length > maxLen ? `${cleaned.substring(0, maxLen - 3)}...` : cleaned;
}

function normalizeGitHubWebhook(eventType, payload) {
  if (eventType === 'release' && ['published', 'released'].includes(payload.action) && payload.release) {
    const repoFullName = payload.repository?.full_name || 'unknown/repo';
    const release = payload.release;

    return [{
      title: `${repoFullName}: ${release.name || release.tag_name}`,
      description: truncate(release.body || '', 500),
      url: release.html_url,
      sourceName: `GitHub: ${repoFullName}`,
      sourceType: 'github',
      priority: 0,
      tags: ['github', 'release', release.prerelease ? 'pre-release' : 'stable'],
      publishedAt: new Date(release.published_at || release.created_at || Date.now()),
    }];
  }

  if (eventType === 'create' && payload.ref_type === 'tag') {
    const repoFullName = payload.repository?.full_name || 'unknown/repo';
    return [{
      title: `${repoFullName}: tag ${payload.ref}`,
      description: `GitHub tag created for ${repoFullName}`,
      url: `https://github.com/${repoFullName}/releases/tag/${payload.ref}`,
      sourceName: `GitHub: ${repoFullName}`,
      sourceType: 'github',
      priority: 1,
      tags: ['github', 'tag'],
      publishedAt: new Date(),
    }];
  }

  return [];
}

module.exports = {
  normalizeGitHubWebhook,
};