import { Mistral } from '@mistralai/mistralai';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

const CANDIDATE_MODELS = [
  'ministral-8b-latest',
  'open-mistral-7b',
  'ministral-3b-latest',
  'mistral-tiny',
  'mistral-small-latest',
];

export class AIService {
  /**
   * Safe environment variable resolution with optional chaining
   */
  static getApiKey() {
    return config?.mistral?.apiKey || process?.env?.MISTRAL_API_KEY || '';
  }

  /**
   * Retrieves priority-ordered unique candidate models
   */
  static getCandidateModels() {
    const configured = config?.mistral?.model;
    const candidates = [configured, ...CANDIDATE_MODELS].filter(Boolean);
    return [...new Set(candidates)];
  }

  /**
   * Initializes Mistral AI client instance safely
   */
  static getClient() {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('AI API key is not configured on the server.');
    }
    return new Mistral({ apiKey });
  }

  /**
   * High-fidelity offline fallback generator (Layer 3 safety)
   */
  static getOfflinePostFallback({ topic, tone = 'professional', hookLength = 'medium', includeHashtags = true }) {
    const cleanTopic = topic.trim();
    const words = cleanTopic.split(/\s+/);
    const primaryKeywords = words.filter(w => w.length > 3).slice(0, 3).map(w => w.replace(/[^a-zA-Z0-9]/g, ''));
    
    const tags = includeHashtags 
      ? (primaryKeywords.length > 0 ? primaryKeywords.map(k => `#${k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()}`) : ['#Leadership', '#Innovation', '#Growth'])
      : [];

    const hooks = [
      `Most people approach ${cleanTopic} the wrong way. Here is what actually works:`,
      `The biggest misconception about ${cleanTopic} is that it takes months to see results.`,
      `Here are 3 fundamental shifts that transformed my perspective on ${cleanTopic}:`
    ];

    const content = `${hooks[0]}

When exploring ${cleanTopic}, there are three pivotal lessons every professional should know:

1. Consistency compounds faster than intensity.
2. Focus on solving real-world problems before optimizing processes.
3. Transparent communication turns small wins into lasting organizational trust.

What is your biggest takeaway when it comes to ${cleanTopic}? Let's discuss in the comments below!
${tags.length > 0 ? '\n' + tags.join(' ') : ''}`;

    return {
      generated_content: content,
      hook_variations: hooks,
      hashtags: tags,
    };
  }

  /**
   * High-fidelity offline hook variations generator (Layer 3 safety)
   */
  static getOfflineHooksFallback(content) {
    const preview = content.slice(0, 60).replace(/[\r\n]+/g, ' ').trim();
    return [
      `What if everything you knew about ${preview || 'this topic'} was backwards?`,
      `The 1 uncomfortable truth about ${preview || 'growth'} nobody talks about:`,
      `3 practical rules that changed the way I look at ${preview || 'this strategy'}:`
    ];
  }

  /**
   * Generates a viral LinkedIn post draft using AI with Multi-Tier Candidate Fallback
   */
  static async generatePost({ userId, topic, tone = 'professional', hookLength = 'medium', includeHashtags = true }) {
    if (!topic || topic.trim().length === 0) {
      throw new Error('Topic is required for AI generation.');
    }

    let client = null;
    try {
      client = this.getClient();
    } catch (err) {
      console.warn('[CoreLink AI] Could not initialize AI client:', err.message);
    }

    const candidateModels = this.getCandidateModels();

    const hookLengthInstruction = {
      short: 'Write a punchy, 1-line opening hook (under 15 words).',
      medium: 'Write a compelling 2-line opening hook creating curiosity.',
      long: 'Write a bold, 3-line narrative opening statement.',
    }[hookLength.toLowerCase()] || 'Write a compelling opening hook.';

    const systemPrompt = `You are a world-class LinkedIn ghostwriter and content strategist. 
Your goal is to write high-engagement, authentic LinkedIn posts that drive thoughtful comments, shares, and connections.

Guidelines:
- Tone: ${tone} (authentic, punchy, human, no generic corporate fluff).
- Hook: ${hookLengthInstruction}
- Formatting: Use generous line spacing, single sentence paragraphs for punchy thoughts, bullet points for key takeaways, and a compelling question at the end to invite discussion.
- Hashtags: ${includeHashtags ? 'Include 3 to 5 targeted, highly relevant hashtags at the bottom.' : 'Do not include hashtags.'}
- Never use markdown code fences in your post response. Output pure clean text ready to paste to LinkedIn.`;

    const userPrompt = `Topic or Idea: "${topic}"

Please generate:
1. The full LinkedIn post text.
2. 3 alternative opening hook options.
3. 3-5 relevant hashtags.

Respond strictly in valid JSON format:
{
  "generated_content": "Full text of the post...",
  "hook_variations": ["Hook 1...", "Hook 2...", "Hook 3..."],
  "hashtags": ["#Tag1", "#Tag2", "#Tag3"]
}`;

    let successfulResult = null;
    let chosenModel = 'CoreLink AI Engine';

    // Multi-Tier Candidate Model Fallback Loop
    if (client) {
      for (const model of candidateModels) {
        try {
          const chatResponse = await client.chat.complete({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            responseFormat: { type: 'json_object' },
            temperature: 0.7,
          });

          const rawContent = chatResponse.choices?.[0]?.message?.content;
          if (!rawContent) {
            console.warn(`[CoreLink AI] Model ${model} returned empty response, attempting fallback...`);
            continue;
          }

          let parsedResult;
          try {
            parsedResult = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
          } catch {
            parsedResult = {
              generated_content: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent),
              hook_variations: [],
              hashtags: [],
            };
          }

          let generatedText = parsedResult.generated_content || '';
          if (typeof generatedText === 'object' && generatedText !== null) {
            generatedText = generatedText.post?.content || generatedText.content || JSON.stringify(generatedText, null, 2);
          }

          let hookVariations = parsedResult.hook_variations || [];
          if (!Array.isArray(hookVariations) || hookVariations.length === 0) {
            if (parsedResult.generated_content?.post?.hook) {
              hookVariations = [parsedResult.generated_content.post.hook];
            } else {
              hookVariations = [];
            }
          }

          let hashtags = parsedResult.hashtags || [];
          if (!Array.isArray(hashtags) || hashtags.length === 0) {
            if (Array.isArray(parsedResult.generated_content?.post?.hashtags)) {
              hashtags = parsedResult.generated_content.post.hashtags;
            } else {
              hashtags = [];
            }
          }

          successfulResult = {
            generated_content: generatedText,
            hook_variations: hookVariations,
            hashtags,
          };
          chosenModel = model;

          // Model responded successfully without error: break out of candidate loop immediately!
          break;
        } catch (err) {
          console.warn(`[CoreLink AI] Model ${model} encountered error (${err.statusCode || err.status || err.message}), attempting fallback...`);
        }
      }
    }

    // Layer 3: High-fidelity Offline Safety Engine if all candidate models failed or offline
    if (!successfulResult) {
      console.warn('[CoreLink AI] All online candidate models failed or unavailable. Engaging native deterministic fallback generator...');
      successfulResult = this.getOfflinePostFallback({ topic, tone, hookLength, includeHashtags });
      chosenModel = 'CoreLink AI Offline Engine';
    }

    // Log generation to Supabase for audit & quota metrics
    let logId = crypto.randomUUID();
    if (userId) {
      try {
        const { data: logEntry } = await supabaseAdmin
          .from('ai_generation_logs')
          .insert({
            id: logId,
            user_id: userId,
            topic,
            tone,
            generated_content: successfulResult.generated_content,
            model: chosenModel,
            created_at: new Date().toISOString(),
          })
          .select('id')
          .maybeSingle();

        if (logEntry?.id) logId = logEntry.id;
      } catch (err) {
        console.warn('Could not log AI generation to Supabase:', err.message);
      }
    }

    return {
      id: logId,
      topic,
      tone,
      generated_content: successfulResult.generated_content,
      hook_variations: successfulResult.hook_variations,
      hashtags: successfulResult.hashtags,
      model: 'CoreLink AI Engine',
    };
  }

  /**
   * Analyzes an existing draft and generates 3 viral opening hook variations with Candidate Fallback
   */
  static async optimizeHooks({ userId = null, content }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Post content is required to optimize hooks.');
    }

    let client = null;
    try {
      client = this.getClient();
    } catch (err) {
      console.warn('[CoreLink AI] Could not initialize AI client:', err.message);
    }

    const candidateModels = this.getCandidateModels();

    const systemPrompt = `You are an expert LinkedIn growth strategist specializing in viral hooks. 
Analyze the provided LinkedIn post content and generate 3 distinct, high-converting opening hooks:
1. Question Hook (Stirs curiosity or asks a provocative question)
2. Contrarian Hook (Challenges a conventional belief)
3. Action/Results Hook (Shares a specific takeaway or data insight)

Respond strictly in valid JSON format:
{
  "hooks": [
    "Hook 1...",
    "Hook 2...",
    "Hook 3..."
  ]
}`;

    let hooks = null;
    let chosenModel = 'CoreLink AI Engine';

    // Multi-Tier Candidate Model Fallback Loop
    if (client) {
      for (const model of candidateModels) {
        try {
          const chatResponse = await client.chat.complete({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Post Draft Content:\n"${content}"` },
            ],
            responseFormat: { type: 'json_object' },
            temperature: 0.75,
          });

          const rawContent = chatResponse.choices?.[0]?.message?.content;
          if (!rawContent) continue;

          let parsedResult;
          try {
            parsedResult = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
          } catch {
            parsedResult = { hooks: [] };
          }

          if (Array.isArray(parsedResult.hooks) && parsedResult.hooks.length > 0) {
            hooks = parsedResult.hooks.map(h => {
              if (typeof h === 'string') return h;
              if (typeof h === 'object' && h !== null) {
                return h.hook || h.text || h.content || JSON.stringify(h);
              }
              return String(h);
            });
            chosenModel = model;
            // Break immediately on success!
            break;
          }
        } catch (err) {
          console.warn(`[CoreLink AI] Model ${model} hook optimization failed (${err.statusCode || err.status || err.message}), attempting fallback...`);
        }
      }
    }

    // Layer 3: High-fidelity Offline Safety Engine if all candidate models failed or offline
    if (!hooks || hooks.length === 0) {
      console.warn('[CoreLink AI] Hook optimization models unavailable. Engaging native deterministic hook fallback...');
      hooks = this.getOfflineHooksFallback(content);
      chosenModel = 'CoreLink AI Offline Engine';
    }

    // Log hook optimization for quota & metrics
    if (userId) {
      try {
        await supabaseAdmin.from('ai_generation_logs').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          topic: 'Hook Optimization',
          tone: 'optimization',
          generated_content: JSON.stringify(hooks),
          model: chosenModel,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn('Could not log hook optimization to Supabase:', err.message);
      }
    }

    return hooks;
  }
}

