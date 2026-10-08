import { Mistral } from "@mistralai/mistralai";
import { config } from "../config/env.js";
import { supabaseAdmin } from "../config/supabase.js";

const CANDIDATE_MODELS = [
  "ministral-8b-latest",
  "open-mistral-7b",
  "ministral-3b-latest",
  "mistral-tiny",
  "mistral-small-latest",
];

export class AIService {
  /**
   * Safe environment variable resolution with optional chaining
   */
  static getApiKey() {
    return config?.mistral?.apiKey || process?.env?.MISTRAL_API_KEY || "";
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
      throw new Error("AI API key is not configured on the server.");
    }
    return new Mistral({ apiKey });
  }

  /**
   * Deep Humanizer programmatic sanitizer
   * Strips out residual AI formatting, em-dashes, markdown symbols, and banned AI clichés
   */
  static humanizeText(text) {
    if (!text || typeof text !== 'string') return text;

    let sanitized = text;

    // 1. Strip markdown bold, italic, and underline markers (**word** -> word, *word* -> word)
    sanitized = sanitized.replace(/\*\*([^*]+)\*\*/g, '$1');
    sanitized = sanitized.replace(/\*([^*]+)\*/g, '$1');
    sanitized = sanitized.replace(/__([^_]+)__/g, '$1');
    sanitized = sanitized.replace(/_([^_]+)_/g, '$1');

    // 2. Replace em-dashes and en-dashes with commas or clean stops
    sanitized = sanitized.replace(/\s*[—–]\s*/g, ', ');

    // 3. Remove decorative bot bullet symbols at line beginnings
    sanitized = sanitized.replace(/^[ \t]*[➜•▪➤✦►▸◆●■★*]\s*/gm, '');

    // 4. Remove semicolons (prefer commas or periods)
    sanitized = sanitized.replace(/;/g, ',');

    // 5. Clean up typical AI conclusion and CTA clichés
    sanitized = sanitized.replace(
      /(?:What are your thoughts\?|Drop your thoughts below|Let me know your thoughts in the comments(?: below)?|What do you think\?|Food for thought|Agree or disagree\?)[.!]?/gi,
      '',
    );
    sanitized = sanitized.replace(
      /^(?:Ultimately|In conclusion|To summarize|In closing|At the end of the day),\s*/gim,
      '',
    );

    // 6. Replace notorious AI buzzwords and phrases from the Deep Humanizer Kill List
    const replacements = [
      [/\bdelve into\b/gi, 'explore'],
      [/\bdelve\b/gi, 'dig'],
      [/\btapestry\b/gi, 'mix'],
      [/\blandscape\b/gi, 'industry'],
      [/\bnavigate\b/gi, 'handle'],
      [/\bmultifaceted\b/gi, 'complex'],
      [/\bnuanced\b/gi, 'subtle'],
      [/\bleverage\b/gi, 'use'],
      [/\bfoster\b/gi, 'build'],
      [/\bspearhead\b/gi, 'lead'],
      [/\bunderscore\b/gi, 'highlight'],
      [/\bharness\b/gi, 'use'],
      [/\brealm\b/gi, 'field'],
      [/\btestament to\b/gi, 'proof of'],
      [/\bbeacon\b/gi, 'guide'],
      [/\bsymphony\b/gi, 'blend'],
      [/\bcrucial\b/gi, 'key'],
      [/\bvital\b/gi, 'key'],
      [/\bparamount\b/gi, 'essential'],
      [/\bpivotal\b/gi, 'key'],
      [/\bgame-changer\b/gi, 'major shift'],
      [/\bgame changer\b/gi, 'major shift'],
      [/\bsupercharge\b/gi, 'speed up'],
      [/\bunleash\b/gi, 'unlock'],
      [/\bdemystify\b/gi, 'clarify'],
      [/\brevolutionize\b/gi, 'transform'],
      [/\bseamless\b/gi, 'smooth'],
      [/\bIn today's world,?\s*/gi, 'Today, '],
      [/\bIt's important to note that\s*/gi, ''],
      [/\bIt's worth mentioning that\s*/gi, ''],
      [/\bDive into\b/gi, 'Look at'],
      [/\bdive into\b/gi, 'look at'],
      [/\bShed light on\b/gi, 'Explain'],
      [/\bshed light on\b/gi, 'explain'],
      [/\bPaint a picture\b/gi, 'Show'],
    ];

    for (const [regex, replacement] of replacements) {
      sanitized = sanitized.replace(regex, replacement);
    }

    // 7. Clean up multiple blank lines and trailing whitespace
    sanitized = sanitized
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim();

    return sanitized;
  }

  /**
   * Maps tone identifiers to Deep Humanizer authentic persona directives
   */
  static getToneInstruction(tone = 'professional') {
    const toneMap = {
      thought_leader:
        'A candid practitioner sharing unvarnished observations from the trenches. Zero buzzwords, zero corporate cheerleading. Speak with quiet, grounded confidence.',
      storyteller:
        'A personal first-person narrative. Start directly inside a specific moment or decision. Focus on real human tension, mistakes made, and practical takeaways. High burstiness with punchy, conversational pacing.',
      data_driven:
        'Concrete, analytical, and grounded in observable reality. Point to specific outcomes and direct observations. Avoid abstract theories and hype.',
      controversial:
        'Unfiltered contrarian point of view. Challenge accepted industry orthodoxies directly in the first line. Do not waffle or hedge.',
      how_to:
        'A pragmatic, step-by-step breakdown from someone who actually executes. Clear, direct sentences with actionable details and zero fluff.',
      inspirational:
        'Grounded empathy and authentic resilience. Rooted in real struggle, not toxic positivity or motivational clichés.',
      professional:
        'Clear, direct, and conversational professional voice. Human, candid, and easy to read.',
    };
    return toneMap[tone.toLowerCase()] || toneMap.professional;
  }

  /**
   * High-fidelity offline fallback generator (Deep Humanizer compliant)
   */
  static getOfflinePostFallback({
    topic,
    tone = 'professional',
    hookLength = 'medium',
    includeHashtags = true,
  }) {
    const cleanTopic = topic.trim();
    const words = cleanTopic.split(/\s+/);
    const primaryKeywords = words
      .filter((w) => w.length > 3)
      .slice(0, 3)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''));

    const tags = includeHashtags
      ? primaryKeywords.length > 0
        ? primaryKeywords.map(
            (k) => `#${k.toLowerCase()}`,
          )
        : ['#leadership', '#work', '#innovation']
      : [];

    const hooks = [
      `Most people overcomplicate ${cleanTopic}. The reality is much simpler.`,
      `Here is what took me five years to understand about ${cleanTopic}.`,
      `If you want real results with ${cleanTopic}, stop copying what everyone else is doing.`,
    ];

    const content = `${hooks[0]}

A lot of teams spend weeks debating strategy when the actual problem is execution.

When I started working with ${cleanTopic}, I thought complexity meant quality. It did not. It just created friction and slowed everyone down.

The teams that win do three things differently:

They prioritize consistency over perfection.

They talk to actual users instead of sitting in planning meetings.

And they fix small bottlenecks before they turn into massive blockers.

Simple approaches are harder to design, but they work much faster.
${tags.length > 0 ? '\n' + tags.join(' ') : ''}`;

    return {
      generated_content: this.humanizeText(content),
      hook_variations: hooks.map((h) => this.humanizeText(h)),
      hashtags: tags,
    };
  }

  /**
   * High-fidelity offline hook variations generator (Deep Humanizer compliant)
   */
  static getOfflineHooksFallback(content) {
    const preview = content
      .slice(0, 60)
      .replace(/[\r\n]+/g, ' ')
      .trim();
    const hooks = [
      `Most people get ${preview || 'this'} completely backwards.`,
      `The hardest lesson I learned about ${preview || 'this work'}:`,
      `Here is why our team stopped doing ${preview || 'this'} the traditional way.`,
    ];
    return hooks.map((h) => this.humanizeText(h));
  }

  /**
   * Generates a viral LinkedIn post draft using AI with Multi-Tier Candidate Fallback
   */
  static async generatePost({
    userId,
    topic,
    tone = 'professional',
    hookLength = 'medium',
    includeHashtags = true,
  }) {
    if (!topic || topic.trim().length === 0) {
      throw new Error('Topic is required for AI generation.');
    }

    let client = null;
    try {
      client = this.getClient();
    } catch (err) {
      console.warn(
        '[CoreLink AI] Could not initialize AI client:',
        err.message,
      );
    }

    const candidateModels = this.getCandidateModels();
    const toneDirective = this.getToneInstruction(tone);

    const hookLengthInstruction =
      {
        short: 'Write a punchy, 1-line opening hook (under 15 words).',
        medium: 'Write a compelling 2-line opening hook creating curiosity.',
        long: 'Write a bold, 3-line narrative opening statement.',
      }[hookLength.toLowerCase()] || 'Write a compelling opening hook.';

    const systemPrompt = `You are an elite ghostwriter executing the Deep Humanizer standard. Your sole mission is to write an authentic LinkedIn post that is 100% indistinguishable from a real human writer. Completely eliminate all default AI behaviors, sterile corporate habits, and robotic formatting.

CORE DEEP HUMANIZER RULES:

1. THE KILL LIST (ABSOLUTELY BANNED WORDS & PHRASES):
Never use any of these words: delve, tapestry, landscape, navigate, multifaceted, nuanced, leverage, foster, spearhead, underscore, harness, realm, testament, beacon, symphony, crucial, vital, paramount, pivotal, game-changer, supercharge, unleash, demystify, revolutionize, seamless.
Never use any of these phrases: "In today's world", "It's important to note", "It's worth mentioning", "At the end of the day", "A testament to", "Dive into", "Shed light on", "Paint a picture", "In the fast-paced world", "Let's unpack this", "Food for thought", "Drop your thoughts below", "What are your thoughts?", "Agree or disagree?".

2. STRUCTURAL & FORMATTING RULES:
- Write in standard, natural human paragraphs separated by blank lines.
- NO bullet points unless explicitly requested by the topic.
- NO markdown formatting whatsoever: DO NOT use bold (**text**), italics (*text*), or headers. Rely strictly on word choice for emphasis.
- NO decorative emoji bullets or glyphs (no ➜, •, ▪, ➤, ✦, 🚀, 💡).
- NO em-dashes (—). Use commas, parentheses, or start a new sentence instead. Zero semicolons.
- NO numbered lists inside paragraphs (do not write "First,... Second,... Third,...").

3. VOICE, TONE & RHYTHM:
- Persona: ${toneDirective}
- Hook Style: ${hookLengthInstruction}
- Drop customer-service politeness and generic corporate fluff. Have a distinct point of view.
- NO pathological balance ("While X is true, it is also important to consider Y"). Just argue the point.
- NO forced conclusions or corporate wrap-ups ("Ultimately,", "In conclusion,", "To summarize,"). End naturally and cleanly when the idea is expressed.
- Burstiness: Mix very short sentences (3 to 6 words) with longer, conversational sentences.
- Use natural conversational rhythm. Start sentences with "And," "But," or "So" where natural. Use occasional sentence fragments for rhythm.
- Hashtags: ${includeHashtags ? 'Include 3 to 5 targeted, lowercase or camelcase hashtags at the bottom.' : 'Do not include any hashtags.'}
- Return the required JSON structure for the API, but keep every post and hook string inside it as plain, paste-ready text.`;

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
    let chosenModel = "CoreLink AI Engine";

    // Multi-Tier Candidate Model Fallback Loop
    if (client) {
      for (const model of candidateModels) {
        try {
          const chatResponse = await client.chat.complete({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            responseFormat: { type: "json_object" },
            temperature: 0.7,
          });

          const rawContent = chatResponse.choices?.[0]?.message?.content;
          if (!rawContent) {
            console.warn(
              `[CoreLink AI] Model ${model} returned empty response, attempting fallback...`,
            );
            continue;
          }

          // A parse failure means the model's output was truncated or malformed.
          // Treat it as this candidate failing and move on to the next one —
          // never wrap broken raw text as if it were valid post content.
          let parsedResult;
          try {
            parsedResult =
              typeof rawContent === "string"
                ? JSON.parse(rawContent)
                : rawContent;
          } catch (parseErr) {
            console.warn(
              `[CoreLink AI] Model ${model} returned invalid/truncated JSON, attempting fallback...`,
              parseErr.message,
            );
            continue;
          }

          let generatedText = parsedResult.generated_content || "";
          if (typeof generatedText === "object" && generatedText !== null) {
            generatedText =
              generatedText.post?.content ||
              generatedText.content ||
              JSON.stringify(generatedText, null, 2);
          }

          // No usable post content means this candidate effectively failed too,
          // even though its JSON technically parsed.
          if (!generatedText || generatedText.trim().length === 0) {
            console.warn(
              `[CoreLink AI] Model ${model} response missing generated_content, attempting fallback...`,
            );
            continue;
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
            generated_content: this.humanizeText(generatedText),
            hook_variations: hookVariations.map((h) => this.humanizeText(h)),
            hashtags,
          };
          chosenModel = model;

          // Model responded successfully without error: break out of candidate loop immediately!
          break;
        } catch (err) {
          console.warn(
            `[CoreLink AI] Model ${model} encountered error (${err.statusCode || err.status || err.message}), attempting fallback...`,
          );
        }
      }
    }

    // Layer 3: High-fidelity Offline Safety Engine if all candidate models failed or offline
    if (!successfulResult) {
      console.warn(
        "[CoreLink AI] All online candidate models failed or unavailable. Engaging native deterministic fallback generator...",
      );
      successfulResult = this.getOfflinePostFallback({
        topic,
        tone,
        hookLength,
        includeHashtags,
      });
      chosenModel = "CoreLink AI Offline Engine";
    }

    // Log generation to Supabase for audit & quota metrics
    let logId = crypto.randomUUID();
    if (userId) {
      try {
        const { data: logEntry } = await supabaseAdmin
          .from("ai_generation_logs")
          .insert({
            id: logId,
            user_id: userId,
            topic,
            tone,
            generated_content: successfulResult.generated_content,
            model: chosenModel,
            created_at: new Date().toISOString(),
          })
          .select("id")
          .maybeSingle();

        if (logEntry?.id) logId = logEntry.id;
      } catch (err) {
        console.warn("Could not log AI generation to Supabase:", err.message);
      }
    }

    return {
      id: logId,
      topic,
      tone,
      generated_content: successfulResult.generated_content,
      hook_variations: successfulResult.hook_variations,
      hashtags: successfulResult.hashtags,
      model: "CoreLink AI Engine",
    };
  }

  /**
   * Analyzes an existing draft and generates 3 viral opening hook variations with Deep Humanizer Candidate Fallback
   */
  static async optimizeHooks({ userId = null, content }) {
    if (!content || content.trim().length === 0) {
      throw new Error("Post content is required to optimize hooks.");
    }

    let client = null;
    try {
      client = this.getClient();
    } catch (err) {
      console.warn(
        "[CoreLink AI] Could not initialize AI client:",
        err.message,
      );
    }

    const candidateModels = this.getCandidateModels();

    const systemPrompt = `You are an elite LinkedIn hook strategist executing the Deep Humanizer standard. Your sole mission is to craft 3 opening hooks that sound 100% written by a real human practitioner, not an AI bot.

DEEP HUMANIZER HOOK RULES:
1. Provide 3 distinct human angles:
   - Curiosity / Question Hook: An intriguing, genuine question or dilemma a real person would ask.
   - Contrarian / Hot Take Hook: A sharp, unexpected perspective that challenges conventional industry assumptions.
   - Lived Experience / Observation Hook: A specific, grounded observation or takeaway from real work.
2. ABSOLUTE KILL LIST (NEVER USE):
   - Never use: delve, leverage, foster, landscape, navigate, crucial, game-changer, vital, tapestry, paramount, pivotal, supercharge.
   - Never use bot formulas: "The #1 secret to...", "Stop doing this in 2026", "Here is what 99% of people get wrong", "Food for thought".
3. NO markdown bolding (**text**), no italics, and no decorative bullets (➜, •, ▪, ➤, ✦, 🚀).
4. NO em-dashes (—). NO semicolons.
5. Write each hook as a raw, paste-ready single line (under 25 words). Plain text only.

Respond strictly in valid JSON format:
{
  "hooks": [
    "Hook 1...",
    "Hook 2...",
    "Hook 3..."
  ]
}`;

    let hooks = null;
    let chosenModel = "CoreLink AI Engine";

    // Multi-Tier Candidate Model Fallback Loop
    if (client) {
      for (const model of candidateModels) {
        try {
          const chatResponse = await client.chat.complete({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Post Draft Content:\n"${content}"` },
            ],
            responseFormat: { type: "json_object" },
            temperature: 0.75,
          });

          const rawContent = chatResponse.choices?.[0]?.message?.content;
          if (!rawContent) continue;

          // A parse failure means the candidate's output was truncated/malformed
          let parsedResult;
          try {
            parsedResult =
              typeof rawContent === "string"
                ? JSON.parse(rawContent)
                : rawContent;
          } catch (parseErr) {
            console.warn(
              `[CoreLink AI] Model ${model} returned invalid/truncated JSON for hooks, attempting fallback...`,
              parseErr.message,
            );
            continue;
          }

          if (
            Array.isArray(parsedResult.hooks) &&
            parsedResult.hooks.length > 0
          ) {
            hooks = parsedResult.hooks.map((h) => {
              let text = "";
              if (typeof h === "string") text = h;
              else if (typeof h === "object" && h !== null) {
                text = h.hook || h.text || h.content || JSON.stringify(h);
              } else {
                text = String(h);
              }
              return this.humanizeText(text);
            });
            chosenModel = model;
            // Break immediately on success!
            break;
          }
        } catch (err) {
          console.warn(
            `[CoreLink AI] Model ${model} hook optimization failed (${err.statusCode || err.status || err.message}), attempting fallback...`,
          );
        }
      }
    }

    // Layer 3: High-fidelity Offline Safety Engine if all candidate models failed or offline
    if (!hooks || hooks.length === 0) {
      console.warn(
        "[CoreLink AI] Hook optimization models unavailable. Engaging native deterministic hook fallback...",
      );
      hooks = this.getOfflineHooksFallback(content);
      chosenModel = "CoreLink AI Offline Engine";
    }

    // Log hook optimization for quota & metrics
    if (userId) {
      try {
        await supabaseAdmin.from("ai_generation_logs").insert({
          id: crypto.randomUUID(),
          user_id: userId,
          topic: "Hook Optimization",
          tone: "optimization",
          generated_content: JSON.stringify(hooks),
          model: chosenModel,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(
          "Could not log hook optimization to Supabase:",
          err.message,
        );
      }
    }

    return hooks;
  }
}
