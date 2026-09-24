// Optional AI triage step (stretch goal). Runs the report text through a FREE
// LLM (Google Gemini via AI Studio, or Groq) to produce a short summary, a tag,
// and a priority. Kept strictly optional: if no provider is configured, or the
// call fails/times out, the caller falls back to the deterministic rule engine
// so an interaction is never lost because the AI was down.

import { config } from '../config.js';

export function aiEnabled() {
  return config.ai.provider !== 'none' && !!config.ai.apiKey;
}

const ALLOWED_PRIORITIES = ['low', 'medium', 'high'];

// Exported for unit testing.
export function coerceResult(obj) {
  const summary = String(obj.summary || '').slice(0, 300).trim();
  let tag = String(obj.tag || obj.category || 'general').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'general';
  let priority = String(obj.priority || 'low').toLowerCase();
  if (!ALLOWED_PRIORITIES.includes(priority)) priority = 'low';
  return { summary, tag, priority };
}

export function extractJson(text) {
  // Models sometimes wrap JSON in prose/markdown fences. Grab the first {...}.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in AI response');
  return JSON.parse(match[0]);
}

const PROMPT = (text) =>
  `You are a triage assistant for a team's incident/report channel. ` +
  `Read the report and reply with ONLY a compact JSON object, no prose, no code fences, ` +
  `with keys: "summary" (one sentence, <= 200 chars), ` +
  `"tag" (one lowercase word, e.g. incident, bug, question, security, performance, general), ` +
  `"priority" (one of: low, medium, high). ` +
  `Report: """${String(text).slice(0, 2000)}"""`;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callGemini(text) {
  const model = config.ai.model || 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.ai.apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(text) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    },
    config.ai.timeoutMs
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return coerceResult(extractJson(out));
}

async function callGroq(text) {
  const model = config.ai.model || 'llama-3.1-8b-instant';
  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [{ role: 'user', content: PROMPT(text) }],
      }),
    },
    config.ai.timeoutMs
  );
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content || '';
  return coerceResult(extractJson(out));
}

/**
 * Run AI triage. Throws on any failure so the caller can fall back to rules.
 * @returns {{summary:string, tag:string, priority:string, source:'ai', provider:string}}
 */
export async function triage(text) {
  if (!aiEnabled()) throw new Error('AI not configured');
  let result;
  if (config.ai.provider === 'gemini') result = await callGemini(text);
  else if (config.ai.provider === 'groq') result = await callGroq(text);
  else throw new Error(`Unknown AI provider: ${config.ai.provider}`);
  return { ...result, source: 'ai', provider: config.ai.provider };
}
