const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const { SDK_SOURCES } = require('../config/sources');
const { MODEL_SEARCH_PATTERNS, KNOWN_MODELS } = require('../config/sdk-models');

/**
 * SDK Tracker Adapter — monitors NPM and PyPI registries for new SDK versions
 * of OpenAI and Anthropic packages, then inspects the source for unreleased model names.
 *
 * Detection flow:
 * 1. Poll registry for current version number
 * 2. Compare against last-seen version (stored in memory)
 * 3. On new version: fetch type definitions from unpkg CDN (NPM) or GitHub (PyPI)
 * 4. Grep for model name patterns not in the known models list
 * 5. Alert on any new model strings found
 */
class SDKTrackerAdapter extends BaseAdapter {
  constructor() {
    super('SDK Supply Chain Tracker', 'sdk-tracker', 1); // P1 — these are significant signals
    this.lastSeenVersions = {}; // { 'openai-npm': '4.73.0', ... }
    this._stateLoaded = false;
  }

  async check() {
    this._ensureStateLoaded();

    const items = [];

    // Check NPM packages
    for (const pkg of SDK_SOURCES.npm) {
      try {
        const npmItems = await this._checkNPM(pkg);
        items.push(...npmItems);
      } catch (error) {
        logger.warn(`[SDK Tracker] NPM check failed for ${pkg.name}: ${error.message}`);
      }
    }

    // Check PyPI packages
    for (const pkg of SDK_SOURCES.pypi) {
      try {
        const pypiItems = await this._checkPyPI(pkg);
        items.push(...pypiItems);
      } catch (error) {
        logger.warn(`[SDK Tracker] PyPI check failed for ${pkg.name}: ${error.message}`);
      }
    }

    return items;
  }

  /**
   * Check an NPM package for new versions and inspect for model name leaks.
   */
  async _checkNPM(pkg) {
    const items = [];
    const versionKey = `${pkg.name}-npm`;

    // Fetch latest version metadata from NPM registry
    const response = await http.get(pkg.url, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const latestVersion = response.data.version;
    if (!latestVersion) return items;

    // First run: just store the version
    if (!this.lastSeenVersions[versionKey]) {
      this.lastSeenVersions[versionKey] = latestVersion;
      this._persistState();
      logger.info(`[SDK Tracker] Initialized ${pkg.name} NPM at v${latestVersion}`);
      return items;
    }

    // No new version
    if (this.lastSeenVersions[versionKey] === latestVersion) return items;

    // New version detected!
    const oldVersion = this.lastSeenVersions[versionKey];
    this.lastSeenVersions[versionKey] = latestVersion;
    this._persistState();
    logger.info(`[SDK Tracker] 🆕 ${pkg.name} NPM: ${oldVersion} → ${latestVersion}`);

    // Always report the new version
    items.push({
      title: `📦 SDK Update: ${pkg.package} v${latestVersion}`,
      description: `New version of \`${pkg.package}\` published on NPM.\nPrevious: v${oldVersion} → New: v${latestVersion}`,
      url: `https://www.npmjs.com/package/${pkg.package}/v/${latestVersion}`,
      sourceName: 'SDK Tracker (NPM)',
      sourceType: 'sdk-tracker',
      priority: 2, // P2 for just the version bump
      tags: ['sdk', 'npm', 'version-update', pkg.name],
      publishedAt: new Date(),
      needsTranslation: false,
    });

    // Try to inspect the package source via unpkg CDN for model name leaks
    try {
      const leakedModels = await this._inspectNPMPackage(pkg.package, latestVersion);
      if (leakedModels.length > 0) {
        items.push({
          title: `🚨 SDK Model Leak: ${leakedModels.length} new model(s) found in ${pkg.package}`,
          description: `Unreleased model name(s) detected in \`${pkg.package}@${latestVersion}\`:\n\n${leakedModels.map(m => `• \`${m}\``).join('\n')}\n\nThese models are NOT yet officially announced.`,
          url: `https://www.npmjs.com/package/${pkg.package}/v/${latestVersion}`,
          sourceName: 'SDK Tracker (NPM)',
          sourceType: 'sdk-tracker',
          priority: 0, // P0 for actual model leaks
          tags: ['sdk', 'npm', 'model-leak', 'rumor', ...leakedModels],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }
    } catch (inspectErr) {
      logger.debug(`[SDK Tracker] Could not inspect ${pkg.package} source: ${inspectErr.message}`);
    }

    return items;
  }

  /**
   * Check a PyPI package for new versions and inspect for model name leaks.
   */
  async _checkPyPI(pkg) {
    const items = [];
    const versionKey = `${pkg.name}-pypi`;

    const response = await http.get(pkg.url, {
      timeout: 10000,
      headers: { Accept: 'application/json' },
    });

    const latestVersion = response.data?.info?.version;
    if (!latestVersion) return items;

    // First run: just store the version
    if (!this.lastSeenVersions[versionKey]) {
      this.lastSeenVersions[versionKey] = latestVersion;
      this._persistState();
      logger.info(`[SDK Tracker] Initialized ${pkg.name} PyPI at v${latestVersion}`);
      return items;
    }

    // No new version
    if (this.lastSeenVersions[versionKey] === latestVersion) return items;

    // New version detected!
    const oldVersion = this.lastSeenVersions[versionKey];
    this.lastSeenVersions[versionKey] = latestVersion;
    this._persistState();
    logger.info(`[SDK Tracker] 🆕 ${pkg.name} PyPI: ${oldVersion} → ${latestVersion}`);

    items.push({
      title: `📦 SDK Update: ${pkg.package} v${latestVersion} (PyPI)`,
      description: `New version of \`${pkg.package}\` published on PyPI.\nPrevious: v${oldVersion} → New: v${latestVersion}`,
      url: `https://pypi.org/project/${pkg.package}/${latestVersion}/`,
      sourceName: 'SDK Tracker (PyPI)',
      sourceType: 'sdk-tracker',
      priority: 2,
      tags: ['sdk', 'pypi', 'version-update', pkg.name],
      publishedAt: new Date(),
      needsTranslation: false,
    });

    // Try to inspect PyPI package source (via GitHub since PyPI doesn't serve individual files easily)
    try {
      const leakedModels = await this._inspectPyPIPackage(pkg, latestVersion);
      if (leakedModels.length > 0) {
        items.push({
          title: `🚨 SDK Model Leak: ${leakedModels.length} new model(s) found in ${pkg.package}`,
          description: `Unreleased model name(s) detected in \`${pkg.package}==${latestVersion}\`:\n\n${leakedModels.map(m => `• \`${m}\``).join('\n')}\n\nThese models are NOT yet officially announced.`,
          url: `https://pypi.org/project/${pkg.package}/${latestVersion}/`,
          sourceName: 'SDK Tracker (PyPI)',
          sourceType: 'sdk-tracker',
          priority: 0,
          tags: ['sdk', 'pypi', 'model-leak', 'rumor', ...leakedModels],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }
    } catch (inspectErr) {
      logger.debug(`[SDK Tracker] Could not inspect ${pkg.package} PyPI source: ${inspectErr.message}`);
    }

    return items;
  }

  /**
   * Inspect an NPM package via unpkg CDN for model name strings.
   */
  async _inspectNPMPackage(packageName, version) {
    const modelNames = new Set();
    const encodedPkg = encodeURIComponent(packageName);

    // Fetch the main type definition file which usually contains model literals
    const inspectUrls = [
      `https://unpkg.com/${packageName}@${version}/dist/index.d.ts`,
      `https://unpkg.com/${packageName}@${version}/dist/resources/chat/completions.d.ts`,
      `https://unpkg.com/${packageName}@${version}/dist/resources/messages.d.ts`,
    ];

    for (const url of inspectUrls) {
      try {
        const response = await http.get(url, { timeout: 10000 });
        const source = response.data;
        if (typeof source !== 'string') continue;

        this._extractModelNames(source, modelNames);
      } catch {
        // File may not exist for this package, that's fine
      }
    }

    return [...modelNames];
  }

  /**
   * Inspect a PyPI package via GitHub for model name strings.
   */
  async _inspectPyPIPackage(pkg, version) {
    const modelNames = new Set();

    // Map package names to GitHub repos
    const githubRepos = {
      openai: 'openai/openai-python',
      anthropic: 'anthropics/anthropic-sdk-python',
    };

    const repo = githubRepos[pkg.name.replace('-python', '')];
    if (!repo) return [];

    const headers = { 'User-Agent': 'ModelLookerBot/1.0' };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }

    // Try to fetch model type files from the GitHub repo at the version tag
    const filePaths = [
      `src/${pkg.package}/types/model_param.py`,
      `src/${pkg.package}/types/chat_model.py`,
      `src/${pkg.package}/resources/messages.py`,
    ];

    for (const filePath of filePaths) {
      try {
        const url = `https://raw.githubusercontent.com/${repo}/v${version}/${filePath}`;
        const response = await http.get(url, { headers, timeout: 10000 });
        const source = response.data;
        if (typeof source !== 'string') continue;

        this._extractModelNames(source, modelNames);
      } catch {
        // File may not exist at this path/version
      }
    }

    return [...modelNames];
  }

  /**
   * Extract model names from source code using pattern matching.
   * Filters out already-known models.
   */
  _extractModelNames(source, modelNames) {
    for (const pattern of MODEL_SEARCH_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const modelName = match[0].toLowerCase();
        // Only flag if it's NOT in the known models set
        if (!KNOWN_MODELS.has(modelName) && !this._isKnownVariant(modelName)) {
          modelNames.add(match[0]);
        }
      }
    }
  }

  /**
   * Check if a model name is a known variant (date-tagged, etc).
   */
  _isKnownVariant(modelName) {
    // Check if it's a date-tagged variant of a known model
    for (const known of KNOWN_MODELS) {
      if (modelName.startsWith(known)) return true;
    }
    return false;
  }

  _ensureStateLoaded() {
    if (this._stateLoaded) return;
    const persisted = this.loadState('last-seen-versions', {});
    if (persisted && typeof persisted === 'object') {
      this.lastSeenVersions = persisted;
    }
    this._stateLoaded = true;
  }

  _persistState() {
    this.saveState('last-seen-versions', this.lastSeenVersions);
  }
}

module.exports = SDKTrackerAdapter;
