import { config } from '../config/env.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { supabaseAdmin } from '../config/supabase.js';

export class DevToService {
  /**
   * Resolves the user's DEV.to API key:
   * 1. Explicitly provided apiKey argument
   * 2. Request header (x-devto-api-key or devto-api-key)
   * 3. Request body or query (devto_api_key or devtoApiKey)
   * 4. User profile in database (decrypted encrypted_devto_api_key)
   */
  static resolveApiKey({ apiKey = null, req = null, userProfile = null } = {}) {
    if (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0) {
      return apiKey.trim();
    }

    if (req) {
      const headerKey = req.headers?.['x-devto-api-key'] || req.headers?.['devto-api-key'];
      if (headerKey && typeof headerKey === 'string' && headerKey.trim().length > 0) {
        return headerKey.trim();
      }

      const bodyKey = req.body?.devto_api_key || req.body?.devtoApiKey || req.query?.devto_api_key;
      if (bodyKey && typeof bodyKey === 'string' && bodyKey.trim().length > 0) {
        return bodyKey.trim();
      }
    }

    if (userProfile?.encrypted_devto_api_key) {
      try {
        const decrypted = decrypt(userProfile.encrypted_devto_api_key);
        if (decrypted && decrypted.trim().length > 0) {
          return decrypted.trim();
        }
      } catch (err) {
        console.warn('[DEV.to] Failed to decrypt user stored Dev.to API key:', err.message);
      }
    }

    return null;
  }

  /**
   * Normalizes tags for DEV.to (Dev.to allows up to 4 tags, lowercase, alphanumeric & underscore)
   */
  static normalizeTags(tags) {
    if (!tags) return [];
    let tagList = [];

    if (Array.isArray(tags)) {
      tagList = tags;
    } else if (typeof tags === 'string') {
      tagList = tags.split(',').map((t) => t.trim());
    }

    const cleaned = tagList
      .map((tag) => String(tag).replace(/^#+/, '').trim().toLowerCase())
      .filter(Boolean)
      .map((tag) => tag.replace(/[^a-z0-9_]/g, ''))
      .filter((tag) => tag.length > 0);

    // DEV.to limits articles to a maximum of 4 tags
    return [...new Set(cleaned)].slice(0, 4);
  }

  /**
   * Automatically extracts hashtags from text content
   */
  static extractTagsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const matches = text.match(/#([a-zA-Z0-9_]+)/g);
    if (!matches) return [];
    return this.normalizeTags(matches);
  }

  /**
   * Intelligently extracts or generates an article title from post content
   */
  static extractTitleFromContent(content) {
    if (!content || typeof content !== 'string') {
      return `Update from ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      return `Update from ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    // Check if the first non-empty line starts with a Markdown heading (# Title)
    const headingMatch = lines[0].match(/^#+\s*(.+)$/);
    if (headingMatch && headingMatch[1].trim()) {
      return headingMatch[1].trim().slice(0, 120);
    }

    // Otherwise use the first line, removing leading/trailing punctuation or hashtags
    let firstLine = lines[0].replace(/#\w+/g, '').replace(/[*-]+/g, '').trim();
    if (firstLine.length > 10) {
      return firstLine.slice(0, 100);
    }

    return `Article: ${lines[0].slice(0, 80)}`;
  }

  /**
   * Converts a CoreLink post into a DEV.to article payload
   */
  static convertPostToDevToArticle(post, overrides = {}) {
    const rawContent = post.content || '';
    const title =
      overrides.title ||
      overrides.devto_title ||
      post.devto_title ||
      this.extractTitleFromContent(rawContent);

    let bodyMarkdown = overrides.body_markdown || overrides.bodyMarkdown || rawContent;

    // Extract tags from overrides or post content
    const overrideTags = overrides.tags || overrides.devto_tags || post.devto_tags;
    const extractedTags = this.extractTagsFromText(rawContent);
    const tags = this.normalizeTags(overrideTags || extractedTags);

    // Handle image attachments: use as main_image if not already embedded
    let mainImage =
      overrides.main_image ||
      overrides.mainImage ||
      overrides.media_url ||
      (post.media_type === 'image' ? post.media_url : null);

    const canonicalUrl =
      overrides.canonical_url ||
      overrides.canonicalUrl ||
      post.devto_canonical_url ||
      null;

    const series = overrides.series || overrides.devto_series || null;
    const description = overrides.description || overrides.devto_description || null;
    const published = overrides.published !== undefined ? Boolean(overrides.published) : true;

    return {
      title,
      body_markdown: bodyMarkdown,
      published,
      tags,
      main_image: mainImage || undefined,
      canonical_url: canonicalUrl || undefined,
      series: series || undefined,
      description: description || undefined,
      organization_id: overrides.organization_id || overrides.organizationId || undefined,
    };
  }

  /**
   * Publishes an article directly to DEV.to (Forem API: POST /api/articles)
   */
  static async publishArticle({
    apiKey,
    title,
    bodyMarkdown,
    published = true,
    tags = [],
    series = null,
    mainImage = null,
    canonicalUrl = null,
    description = null,
    organizationId = null,
  }) {
    if (!apiKey) {
      throw new Error(
        'DEV.to API key is required. Please pass your DEV.to API key in App Settings.'
      );
    }

    if (!title || String(title).trim().length === 0) {
      throw new Error('Article title is required by DEV.to API.');
    }

    if (!bodyMarkdown || String(bodyMarkdown).trim().length === 0) {
      throw new Error('Article body_markdown content is required by DEV.to API.');
    }

    const normalizedTags = this.normalizeTags(tags);
    const apiUrl = config.devto?.apiUrl || 'https://dev.to/api';

    const articlePayload = {
      title: String(title).trim(),
      body_markdown: String(bodyMarkdown).trim(),
      published: Boolean(published),
    };

    if (normalizedTags.length > 0) {
      articlePayload.tags = normalizedTags;
    }
    if (series && String(series).trim()) {
      articlePayload.series = String(series).trim();
    }
    if (mainImage && String(mainImage).trim()) {
      articlePayload.main_image = String(mainImage).trim();
    }
    if (canonicalUrl && String(canonicalUrl).trim()) {
      articlePayload.canonical_url = String(canonicalUrl).trim();
    }
    if (description && String(description).trim()) {
      articlePayload.description = String(description).trim();
    }
    if (organizationId) {
      articlePayload.organization_id = organizationId;
    }

    const response = await fetch(`${apiUrl}/articles`, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'Corelink-Server/1.0',
      },
      body: JSON.stringify({ article: articlePayload }),
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      const errorMsg =
        data.error ||
        data.errors?.join(', ') ||
        data.message ||
        `DEV.to API responded with status ${response.status}`;
      throw new Error(`DEV.to Article Creation Failed (${response.status}): ${errorMsg}`);
    }

    return {
      id: data.id,
      title: data.title,
      url: data.url,
      canonicalUrl: data.canonical_url || null,
      slug: data.slug,
      path: data.path,
      published: data.published !== undefined ? Boolean(data.published) : Boolean(published),
      publishedAt: data.published_at || data.published_timestamp || new Date().toISOString(),
      commentsCount: data.comments_count || 0,
      reactionsCount: data.public_reactions_count || 0,
      pageViewsCount: data.page_views_count || 0,
      coverImage: data.cover_image || data.main_image || null,
      user: data.user
        ? {
            name: data.user.name,
            username: data.user.username,
            profileImage: data.user.profile_image,
          }
        : null,
      raw: data,
    };
  }

  /**
   * Updates an existing article on DEV.to (PUT /api/articles/:id)
   */
  static async updateArticle({ apiKey, articleId, articleData }) {
    if (!apiKey) {
      throw new Error('DEV.to API key is required. Please pass your DEV.to API key in App Settings.');
    }
    if (!articleId) {
      throw new Error('DEV.to article ID is required for update.');
    }

    const apiUrl = config.devto?.apiUrl || 'https://dev.to/api';
    const response = await fetch(`${apiUrl}/articles/${articleId}`, {
      method: 'PUT',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'Corelink-Server/1.0',
      },
      body: JSON.stringify({ article: articleData }),
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      const errorMsg = data.error || data.errors?.join(', ') || data.message || `Status ${response.status}`;
      throw new Error(`DEV.to Article Update Failed (${response.status}): ${errorMsg}`);
    }

    return {
      id: data.id,
      title: data.title,
      url: data.url,
      published: data.published !== undefined ? Boolean(data.published) : (articleData.published !== undefined ? Boolean(articleData.published) : true),
      publishedAt: data.published_at || new Date().toISOString(),
      raw: data,
    };
  }

  /**
   * Fetches an article by ID from DEV.to (GET /api/articles/:id)
   */
  static async getArticle({ apiKey = null, articleId }) {
    if (!articleId) {
      throw new Error('DEV.to article ID is required.');
    }

    const apiUrl = config.devto?.apiUrl || 'https://dev.to/api';
    const headers = {
      'User-Agent': 'Corelink-Server/1.0',
    };
    if (apiKey) {
      headers['api-key'] = apiKey;
    }

    const response = await fetch(`${apiUrl}/articles/${articleId}`, {
      method: 'GET',
      headers,
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      throw new Error(`DEV.to Get Article Failed (${response.status}): ${data.error || responseText}`);
    }

    return data;
  }

  /**
   * Fetches authenticated user's articles from DEV.to (GET /api/articles/me)
   */
  static async getUserArticles({ apiKey, page = 1, perPage = 30, state = 'all' }) {
    if (!apiKey) {
      throw new Error('DEV.to API key is required. Please pass your DEV.to API key in App Settings.');
    }

    const apiUrl = config.devto?.apiUrl || 'https://dev.to/api';
    let path = '/articles/me/all';
    if (state === 'published') {
      path = '/articles/me/published';
    } else if (state === 'unpublished') {
      path = '/articles/me/unpublished';
    }

    const query = new URLSearchParams({
      page: String(page),
      per_page: String(Math.min(perPage, 1000)),
    });

    const response = await fetch(`${apiUrl}${path}?${query.toString()}`, {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        'User-Agent': 'Corelink-Server/1.0',
      },
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      throw new Error(`DEV.to Get User Articles Failed (${response.status}): ${data.error || responseText}`);
    }

    return Array.isArray(data) ? data : [];
  }

  /**
   * Verifies DEV.to API key and returns authenticated user profile (GET /api/users/me)
   */
  static async getProfile({ apiKey }) {
    if (!apiKey) {
      throw new Error('DEV.to API key is required. Please pass your DEV.to API key in App Settings.');
    }

    const apiUrl = config.devto?.apiUrl || 'https://dev.to/api';
    const response = await fetch(`${apiUrl}/users/me`, {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        'User-Agent': 'Corelink-Server/1.0',
      },
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (!response.ok) {
      throw new Error(`DEV.to Profile Verification Failed (${response.status}): ${data.error || responseText}`);
    }

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      summary: data.summary,
      twitterUsername: data.twitter_username,
      githubUsername: data.github_username,
      profileImage: data.profile_image,
      joinedAt: data.joined_at,
    };
  }

  /**
   * Converts a CoreLink post and publishes it to DEV.to
   */
  static async publishPostToDevTo({ post, apiKey, overrides = {} }) {
    const articlePayload = this.convertPostToDevToArticle(post, overrides);
    return this.publishArticle({
      apiKey,
      title: articlePayload.title,
      bodyMarkdown: articlePayload.body_markdown,
      published: articlePayload.published,
      tags: articlePayload.tags,
      series: articlePayload.series,
      mainImage: articlePayload.main_image,
      canonicalUrl: articlePayload.canonical_url,
      description: articlePayload.description,
      organizationId: articlePayload.organization_id,
    });
  }

  /**
   * Connects and verifies a user's DEV.to API key, persisting it securely (AES-256 encrypted) in profiles.
   */
  static async connectUserApiKey({ userId, apiKey }) {
    if (!userId) {
      throw new Error('User ID is required to connect DEV.to.');
    }
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('DEV.to API key is required. Please pass your DEV.to API key in App Settings.');
    }

    const cleanKey = apiKey.trim();

    // 1. Verify key with DEV.to API
    const profile = await this.getProfile({ apiKey: cleanKey });

    // 2. Encrypt API key
    const encryptedKey = encrypt(cleanKey);

    // 3. Persist into profiles table
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        encrypted_devto_api_key: encryptedKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('[DevToService] Failed to persist encrypted DEV.to API key:', error);
      throw new Error(`Failed to save DEV.to credentials: ${error.message}`);
    }

    return {
      connected: true,
      profile,
      message: `DEV.to account connected successfully as @${profile.username}`,
    };
  }

  /**
   * Disconnects a user's DEV.to account by removing encrypted key from profiles.
   */
  static async disconnectUserApiKey({ userId }) {
    if (!userId) {
      throw new Error('User ID is required to disconnect DEV.to.');
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        encrypted_devto_api_key: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      console.error('[DevToService] Failed to clear encrypted DEV.to API key:', error);
      throw new Error(`Failed to disconnect DEV.to account: ${error.message}`);
    }

    return {
      connected: false,
      message: 'DEV.to account disconnected successfully.',
    };
  }

  /**
   * Retrieves DEV.to connection status for a user.
   */
  static async getConnectionStatus({ userId }) {
    if (!userId) {
      return { connected: false, profile: null };
    }

    const { data: profileRow, error } = await supabaseAdmin
      .from('profiles')
      .select('id, encrypted_devto_api_key')
      .eq('id', userId)
      .single();

    if (error || !profileRow?.encrypted_devto_api_key) {
      return { connected: false, profile: null };
    }

    try {
      const apiKey = decrypt(profileRow.encrypted_devto_api_key);
      if (!apiKey) return { connected: false, profile: null };

      const devtoProfile = await this.getProfile({ apiKey });
      return {
        connected: true,
        profile: devtoProfile,
      };
    } catch (err) {
      console.warn('[DevToService] Stored DEV.to key verification error:', err.message);
      return {
        connected: false,
        profile: null,
        error: err.message,
      };
    }
  }
}

