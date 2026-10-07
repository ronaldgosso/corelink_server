import { DevToService } from '../services/devto.service.js';
import { PostService } from '../services/post.service.js';
import { PublishService } from '../services/publish.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { redisService } from '../services/redis.service.js';

/**
 * Creates and publishes an article directly on DEV.to as per DEV.to documentation
 * Endpoint: POST /api/devto/articles
 */
export const handleCreateDevToArticle = async (req, res) => {
  try {
    const {
      title,
      body_markdown,
      bodyMarkdown,
      content,
      published = true,
      tags = [],
      series = null,
      main_image,
      mainImage,
      media_url,
      canonical_url,
      canonicalUrl,
      description = null,
      organization_id,
      organizationId,
      save_to_corelink = true,
      api_key,
      devto_api_key,
    } = req.body;

    const finalTitle = title || req.body?.devto_title;
    const finalBody = body_markdown || bodyMarkdown || content;
    const finalMainImage = main_image || mainImage || media_url;
    const finalCanonicalUrl = canonical_url || canonicalUrl;
    const finalOrgId = organization_id || organizationId;

    if (!finalTitle || String(finalTitle).trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Title is required for DEV.to article (e.g. { "title": "My Article Title" }).',
      });
    }

    if (!finalBody || String(finalBody).trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Body markdown/content is required for DEV.to article (e.g. { "body_markdown": "..." }).',
      });
    }

    // Resolve DEV.to API key
    const apiKey = DevToService.resolveApiKey({
      apiKey: api_key || devto_api_key,
      req,
      userProfile: req.user,
    });

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'DEV.to API key is required. Please pass your DEV.to API key in App Settings.',
      });
    }

    // Publish to DEV.to
    const publishedArticle = await DevToService.publishArticle({
      apiKey,
      title: finalTitle,
      bodyMarkdown: finalBody,
      published,
      tags,
      series,
      mainImage: finalMainImage,
      canonicalUrl: finalCanonicalUrl,
      description,
      organizationId: finalOrgId,
    });

    let savedPost = null;

    // Optionally persist in Corelink posts history
    if (save_to_corelink && req.user?.id) {
      try {
        const nowIso = new Date().toISOString();
        const insertPayload = {
          user_id: req.user.id,
          content: finalBody,
          media_url: finalMainImage || null,
          media_type: finalMainImage ? 'image' : 'none',
          status: 'published',
          scheduled_at: nowIso,
          published_at: publishedArticle.publishedAt || nowIso,
          platforms: ['devto'],
          devto_article_id: publishedArticle.id,
          devto_url: publishedArticle.url,
          devto_published_at: publishedArticle.publishedAt || nowIso,
          devto_title: finalTitle,
          devto_tags: publishedArticle.raw?.tags || tags,
          devto_canonical_url: finalCanonicalUrl,
          created_at: nowIso,
          updated_at: nowIso,
        };

        const { data, error } = await supabaseAdmin
          .from('posts')
          .insert(insertPayload)
          .select('*')
          .single();

        if (!error && data) {
          savedPost = PostService.formatPost(data);
        } else if (error && error.message.includes('column')) {
          // If columns not migrated, retry with standard columns
          delete insertPayload.platforms;
          delete insertPayload.devto_article_id;
          delete insertPayload.devto_url;
          delete insertPayload.devto_published_at;
          delete insertPayload.devto_title;
          delete insertPayload.devto_tags;
          delete insertPayload.devto_canonical_url;

          const fallbackRes = await supabaseAdmin
            .from('posts')
            .insert(insertPayload)
            .select('*')
            .single();

          if (fallbackRes.data) {
            savedPost = PostService.formatPost(fallbackRes.data);
          }
        }

        // Invalidate Redis caches for user posts
        await redisService.delPattern(`cache:posts:${req.user.id}:*`);
        await redisService.del(`cache:stats:${req.user.id}`);
      } catch (dbErr) {
        console.warn('[handleCreateDevToArticle] CoreLink post tracking notice:', dbErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      source: 'DEV_TO',
      message: publishedArticle.published
        ? 'Article published successfully to DEV.to'
        : 'Article draft created successfully on DEV.to',
      article: publishedArticle,
      data: publishedArticle,
      corelink_post: savedPost,
    });
  } catch (error) {
    console.error('Create DEV.to article error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create article on DEV.to',
    });
  }
};

/**
 * Retrieves authenticated user's articles from DEV.to
 * Endpoint: GET /api/devto/articles
 */
export const handleGetDevToArticles = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const perPage = parseInt(req.query.per_page || req.query.perPage || '30', 10);
    const state = req.query.state || 'all'; // 'all', 'published', 'unpublished'

    const apiKey = DevToService.resolveApiKey({
      apiKey: req.query.api_key || req.query.devto_api_key,
      req,
      userProfile: req.user,
    });

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'DEV.to API key is required. Please pass your DEV.to API key in App Settings.',
      });
    }

    const articles = await DevToService.getUserArticles({
      apiKey,
      page,
      perPage,
      state,
    });

    return res.status(200).json({
      success: true,
      source: 'DEV_TO',
      count: articles.length,
      page,
      per_page: perPage,
      articles,
      data: articles,
    });
  } catch (error) {
    console.error('Get DEV.to articles error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve articles from DEV.to',
    });
  }
};

/**
 * Retrieves a single DEV.to article by ID
 * Endpoint: GET /api/devto/articles/:id
 */
export const handleGetDevToArticleById = async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = DevToService.resolveApiKey({
      apiKey: req.query.api_key || req.query.devto_api_key,
      req,
      userProfile: req.user,
    });

    const article = await DevToService.getArticle({
      apiKey,
      articleId: id,
    });

    return res.status(200).json({
      success: true,
      source: 'DEV_TO',
      article,
      data: article,
    });
  } catch (error) {
    console.error('Get DEV.to article by ID error:', error);
    return res.status(error.message.includes('404') ? 404 : 500).json({
      success: false,
      error: error.message || 'Failed to retrieve DEV.to article',
    });
  }
};

/**
 * Updates an existing article on DEV.to
 * Endpoint: PUT /api/devto/articles/:id
 */
export const handleUpdateDevToArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = DevToService.resolveApiKey({
      apiKey: req.body?.api_key || req.body?.devto_api_key,
      req,
      userProfile: req.user,
    });

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'DEV.to API key is required. Please pass your DEV.to API key in App Settings.',
      });
    }

    const articleData = { ...req.body };
    delete articleData.api_key;
    delete articleData.devto_api_key;

    if (articleData.tags) {
      articleData.tags = DevToService.normalizeTags(articleData.tags);
    }

    const updated = await DevToService.updateArticle({
      apiKey,
      articleId: id,
      articleData,
    });

    return res.status(200).json({
      success: true,
      source: 'DEV_TO',
      message: 'Article updated successfully on DEV.to',
      article: updated,
      data: updated,
    });
  } catch (error) {
    console.error('Update DEV.to article error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to update article on DEV.to',
    });
  }
};

/**
 * Validates DEV.to API key and returns authenticated user profile
 * Endpoint: GET /api/devto/me
 */
export const handleGetDevToProfile = async (req, res) => {
  try {
    const apiKey = DevToService.resolveApiKey({
      apiKey: req.query.api_key || req.query.devto_api_key,
      req,
      userProfile: req.user,
    });

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'DEV.to API key is required. Please pass your DEV.to API key in App Settings.',
      });
    }

    const profile = await DevToService.getProfile({ apiKey });

    return res.status(200).json({
      success: true,
      source: 'DEV_TO',
      message: 'DEV.to API key verified successfully',
      profile,
      data: profile,
    });
  } catch (error) {
    console.error('Get DEV.to profile error:', error);
    return res.status(401).json({
      success: false,
      error: error.message || 'Invalid DEV.to API key or connection error',
    });
  }
};

/**
 * Cross-posts an existing CoreLink post to DEV.to
 * Endpoint: POST /api/devto/crosspost/:id
 */
export const handleCrossPostToDevTo = async (req, res) => {
  try {
    const { id } = req.params;
    const devtoApiKey = req.body?.devto_api_key || req.headers['x-devto-api-key'] || null;

    const overrides = {
      title: req.body?.title || req.body?.devto_title,
      tags: req.body?.tags || req.body?.devto_tags,
      canonical_url: req.body?.canonical_url || req.body?.devto_canonical_url,
      series: req.body?.series || req.body?.devto_series,
      description: req.body?.description || req.body?.devto_description,
      published: req.body?.published,
    };

    const publishResult = await PublishService.publishDevToOnly({
      userId: req.user.id,
      postId: id,
      overrides,
      devtoApiKey,
      req,
    });

    return res.status(200).json({
      success: true,
      source: 'DEV_TO',
      message: 'Post successfully cross-posted to DEV.to',
      results: publishResult.results,
      post: publishResult.post,
      data: publishResult.post,
    });
  } catch (error) {
    console.error('Cross-post to DEV.to error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to cross-post to DEV.to',
    });
  }
};
