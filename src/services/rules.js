// Configurable rule engine. Behavior is driven by per-guild config (editable in
// the dashboard), not hard-coded — this is the "configurable command rules"
// stretch goal. Rules are a deterministic baseline that also acts as the
// fallback whenever the AI step is disabled or fails.

const PRIORITY_RANK = { low: 0, medium: 1, high: 2 };

export function defaultConfig() {
  return {
    commands: {
      status: {
        enabled: true,
        ephemeral: false,
      },
      report: {
        enabled: true,
        useAI: true, // only takes effect if an AI provider is configured
        postToChannel: true, // also post the report into the configured channel
        mirror: true, // mirror a notification to the second channel
        ephemeralAck: false,
        defaultLabel: 'general',
        defaultPriority: 'low',
        rules: [
          { keyword: 'outage', label: 'incident', priority: 'high' },
          { keyword: 'down', label: 'incident', priority: 'high' },
          { keyword: 'urgent', label: 'urgent', priority: 'high' },
          { keyword: 'security', label: 'security', priority: 'high' },
          { keyword: 'bug', label: 'bug', priority: 'medium' },
          { keyword: 'error', label: 'bug', priority: 'medium' },
          { keyword: 'slow', label: 'performance', priority: 'medium' },
          { keyword: 'question', label: 'question', priority: 'low' },
        ],
      },
    },
  };
}

// Merge a guild's stored config over the defaults so missing keys are always safe.
export function getCommandConfig(guildConfig, name) {
  const base = defaultConfig().commands[name] || {};
  const override = (guildConfig && guildConfig.commands && guildConfig.commands[name]) || {};
  const merged = { ...base, ...override };
  if (name === 'report' && !Array.isArray(override.rules)) merged.rules = base.rules;
  return merged;
}

/**
 * Apply keyword rules to text.
 * @returns {{label:string, priority:string, matched:string[], source:'rules'}}
 */
export function applyRules(text, reportConfig) {
  const cfg = reportConfig || defaultConfig().commands.report;
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const hay = String(text || '').toLowerCase();

  const matched = [];
  let best = null;
  for (const r of rules) {
    if (!r || !r.keyword) continue;
    if (hay.includes(String(r.keyword).toLowerCase())) {
      matched.push(r.keyword);
      const rank = PRIORITY_RANK[r.priority] ?? 0;
      if (!best || rank > (PRIORITY_RANK[best.priority] ?? 0)) best = r;
    }
  }

  if (best) {
    return { label: best.label, priority: best.priority, matched, source: 'rules' };
  }
  return {
    label: cfg.defaultLabel || 'general',
    priority: cfg.defaultPriority || 'low',
    matched,
    source: 'rules',
  };
}
