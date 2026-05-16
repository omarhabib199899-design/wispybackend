const OpenAI = require('openai');
const Groq   = require('groq-sdk');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const OPENAI_MODEL = 'gpt-4o';

/**
 * Generate a chatbot response.
 * Tries OpenAI first, falls back to Groq if OpenAI fails.
 * Returns { content, model, tokens, latency }
 */
exports.generateResponse = async (messages, systemPrompt, options = {}) => {
  const startTime = Date.now();
  const {
    temperature = 0.7,
    maxTokens   = 300,
  } = options;

  const payload = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  // ── Try OpenAI ─────────────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await openai.chat.completions.create({
        model:       OPENAI_MODEL,
        messages:    payload,
        temperature,
        max_tokens:  maxTokens,
      });
      return {
        content: res.choices[0].message.content.trim(),
        model:   OPENAI_MODEL,
        tokens:  res.usage?.total_tokens || 0,
        latency: Date.now() - startTime,
      };
    } catch (err) {
      console.warn('OpenAI failed, falling back to Groq:', err.message);
    }
  }

  // ── Fallback to Groq ───────────────────────────────────────────────────────
  const res = await groq.chat.completions.create({
    model:      GROQ_MODEL,
    messages:   payload,
    temperature,
    max_tokens: maxTokens,
  });

  return {
    content: res.choices[0].message.content.trim(),
    model:   GROQ_MODEL,
    tokens:  res.usage?.total_tokens || 0,
    latency: Date.now() - startTime,
  };
};

/**
 * Detect if a message contains contact info (lead detection).
 * Returns { hasLead, name, email, phone, topic }
 */
exports.detectLeadInfo = async (conversationText) => {
  const prompt = `Analyze this chat conversation and extract any contact information the user shared.
Return ONLY valid JSON in this exact format (use null for missing fields):
{
  "hasLead": true/false,
  "name": "string or null",
  "email": "string or null",
  "phone": "string or null",
  "topic": "one sentence about what they need, or null"
}

Conversation:
${conversationText}`;

  try {
    const res = await groq.chat.completions.create({
      model:      GROQ_MODEL,
      messages:   [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens:  200,
    });
    const text    = res.choices[0].message.content.trim();
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (_) {
    return { hasLead: false, name: null, email: null, phone: null, topic: null };
  }
};

/**
 * Generate a short summary of a conversation (for leads page).
 */
exports.summarizeConversation = async (messages) => {
  const text = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  try {
    const res = await groq.chat.completions.create({
      model:      GROQ_MODEL,
      messages:   [{
        role:    'user',
        content: `Summarize this customer chat in one sentence (max 20 words): \n\n${text}`,
      }],
      temperature: 0.3,
      max_tokens:  60,
    });
    return res.choices[0].message.content.trim();
  } catch (_) {
    return null;
  }
};

/**
 * Scrape and summarize a URL into knowledge content.
 */
exports.summarizeUrlContent = async (rawText, url) => {
  try {
    const res = await groq.chat.completions.create({
      model:      GROQ_MODEL,
      messages:   [{
        role:    'user',
        content: `Extract and summarize the most important business information from this webpage content. 
Focus on: services, prices, hours, contact info, FAQs, policies.
Keep it under 600 words. Source: ${url}

Content:
${rawText.substring(0, 4000)}`,
      }],
      temperature: 0.3,
      max_tokens:  700,
    });
    return res.choices[0].message.content.trim();
  } catch (_) {
    return rawText.substring(0, 600);
  }
};
