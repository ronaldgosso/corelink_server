import { Mistral } from '@mistralai/mistralai';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

export class AIService {
  /**
   * Initializes Mistral AI client instance
   */
  static getClient() {
    const apiKey = config.mistral.apiKey;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY is not configured on the server.');
    }
    return new Mistral({ apiKey });
  }

  /**
   * Generates a viral LinkedIn post draft using Mistral AI
   */
  static async generatePost({ userId, topic, tone = 'professional', hookLength = 'medium', includeHashtags = true }) {
    if (!topic || topic.trim().length === 0) {
      throw new Error('Topic is required for AI generation.');
    }

    const client = this.getClient();
    const model = config.mistral.model || 'mistral-small-latest';

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
      throw new Error('Empty response received from Mistral AI.');
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

    const generatedText = parsedResult.generated_content || '';
    const hookVariations = parsedResult.hook_variations || [];
    const hashtags = parsedResult.hashtags || [];

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
            generated_content: generatedText,
            model,
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
      generated_content: generatedText,
      hook_variations: hookVariations,
      hashtags,
      model,
    };
  }

  /**
   * Analyzes an existing draft and generates 3 viral opening hook variations
   */
  static async optimizeHooks({ content }) {
    if (!content || content.trim().length === 0) {
      throw new Error('Post content is required to optimize hooks.');
    }

    const client = this.getClient();
    const model = config.mistral.model || 'mistral-small-latest';

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
    let parsedResult;
    try {
      parsedResult = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
    } catch {
      parsedResult = { hooks: [] };
    }

    return parsedResult.hooks || [];
  }
}
