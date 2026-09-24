'use strict';

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function relTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return d.toLocaleString();
}

let toastTimer;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast ' + kind), 3200);
}

// ---------- state ----------
const state = { guilds: [], overview: null, currentTab: 'overview' };

// ---------- tabs ----------
$$('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('nav.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.panel').forEach((p) => p.classList.remove('active'));
    const tab = btn.dataset.tab;
    $(`#panel-${tab}`).classList.add('active');
    state.currentTab = tab;
    if (tab === 'log') loadLog();
    if (tab === 'config') loadConfigForSelected();
  });
});

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
});

// ---------- overview ----------
async function loadOverview() {
  const data = await api('/api/overview');
  state.overview = data;
  state.guilds = data.guilds || [];
  $('#who').textContent = data.admin ? data.admin.username : '';

  // cards
  const aiLabel = data.aiEnabled ? `${data.aiProvider}` : `off`;
  $('#overview-cards').innerHTML = `
    <div class="card">
      <h3>Interactions endpoint</h3>
      <div class="mono copyable" title="Click to copy" data-copy="${esc(data.interactionsEndpoint)}">${esc(data.interactionsEndpoint)}</div>
    </div>
    <div class="card">
      <h3>Connected servers</h3>
      <div class="big">${state.guilds.length}</div>
    </div>
    <div class="card">
      <h3>AI triage</h3>
      <div class="big" style="text-transform:capitalize;">${esc(aiLabel)}</div>
    </div>
    <div class="card">
      <h3>Total commands</h3>
      <div class="big">${state.guilds.reduce((a, g) => a + (g.stats?.total || 0), 0)}</div>
    </div>`;

  $('#invite-btn').href = data.inviteUrl;

  // servers table
  const body = $('#servers-body');
  if (!state.guilds.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No servers yet. Add the bot and run a command, or connect one below.</td></tr>`;
  } else {
    body.innerHTML = state.guilds
      .map(
        (g) => `<tr>
          <td>${esc(g.name || g.id)}</td>
          <td>${g.post_channel_id ? '#' + esc(g.post_channel_id) : '<span class="muted">not set</span>'}</td>
          <td>${g.mirror_type === 'none' ? '<span class="muted">none</span>' : esc(g.mirror_type) + (g.mirror_configured ? '' : ' <span class="muted">(not set)</span>')}</td>
          <td>${g.stats?.total ?? 0}</td>
          <td>${g.stats?.failed ? '<span class="badge failed">' + g.stats.failed + '</span>' : '0'}</td>
          <td class="muted">${relTime(g.stats?.lastAt)}</td>
        </tr>`
      )
      .join('');
  }

  // populate guild selects (log + config)
  const opts = state.guilds.map((g) => `<option value="${esc(g.id)}">${esc(g.name || g.id)}</option>`).join('');
  $('#log-guild').innerHTML = `<option value="">All servers</option>` + opts;
  $('#config-guild').innerHTML = state.guilds.length ? opts : `<option value="">No servers yet</option>`;
}

// copy-to-clipboard on endpoint
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-copy]');
  if (el) {
    navigator.clipboard.writeText(el.dataset.copy).then(() => toast('Copied to clipboard', 'success'));
  }
});

// ---------- connect a server ----------
$('#load-guilds').addEventListener('click', async () => {
  const btn = $('#load-guilds');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Loading…';
  try {
    const { guilds } = await api('/api/discord/guilds');
    renderConnectList(guilds);
  } catch (err) {
    $('#connect-area').innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔄 Load my servers';
  }
});

function renderConnectList(guilds) {
  const area = $('#connect-area');
  if (!guilds.length) {
    area.innerHTML = `<p class="muted">The bot isn't in any servers yet. Use "Add bot to a server" first.</p>`;
    return;
  }
  area.innerHTML = `
    <label class="field" style="max-width:320px;"><span>Choose a server the bot is in</span>
      <select id="connect-guild"><option value="">Select…</option>
        ${guilds.map((g) => `<option value="${esc(g.id)}" data-name="${esc(g.name)}">${esc(g.name)}${g.connected ? ' ✓' : ''}</option>`).join('')}
      </select>
    </label>
    <div id="connect-form"></div>`;
  $('#connect-guild').addEventListener('change', (e) => {
    const id = e.target.value;
    const name = e.target.selectedOptions[0]?.dataset.name || '';
    if (id) loadConnectForm(id, name);
    else $('#connect-form').innerHTML = '';
  });
}

async function loadConnectForm(guildId, guildName) {
  const form = $('#connect-form');
  form.innerHTML = '<p class="muted"><span class="spinner"></span> Loading channels…</p>';
  let channels = [];
  try {
    ({ channels } = await api(`/api/discord/guilds/${guildId}/channels`));
  } catch (err) {
    form.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
    return;
  }
  const existing = state.guilds.find((g) => g.id === guildId) || {};
  const chOpts = (sel) =>
    channels.map((c) => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('');

  form.innerHTML = `
    <div class="row">
      <label class="field"><span>Post channel (where /report is posted)</span>
        <select id="c-post"><option value="">— none —</option>${chOpts(existing.post_channel_id)}</select></label>
      <label class="field"><span>Mirror type (second channel notification)</span>
        <select id="c-mtype">
          <option value="none" ${existing.mirror_type === 'none' ? 'selected' : ''}>None</option>
          <option value="discord" ${existing.mirror_type === 'discord' ? 'selected' : ''}>Discord channel</option>
          <option value="slack" ${existing.mirror_type === 'slack' ? 'selected' : ''}>Slack webhook</option>
        </select></label>
    </div>
    <div id="mirror-target-wrap"></div>
    <button class="btn" id="c-save">Save connection</button>`;

  const renderTarget = () => {
    const type = $('#c-mtype').value;
    const wrap = $('#mirror-target-wrap');
    if (type === 'discord') {
      wrap.innerHTML = `<label class="field" style="max-width:400px;"><span>Mirror Discord channel</span><select id="c-mtarget"><option value="">— select —</option>${chOpts(existing.mirror_type === 'discord' ? existing.mirror_target_display : '')}</select></label>`;
    } else if (type === 'slack') {
      wrap.innerHTML = `<label class="field" style="max-width:520px;"><span>Slack Incoming Webhook URL ${existing.mirror_configured && existing.mirror_type === 'slack' ? '(already set — leave blank to keep)' : ''}</span><input type="password" id="c-mtarget" placeholder="https://hooks.slack.com/services/…" /></label>`;
    } else {
      wrap.innerHTML = '';
    }
  };
  renderTarget();
  $('#c-mtype').addEventListener('change', renderTarget);

  $('#c-save').addEventListener('click', async () => {
    const payload = {
      name: guildName,
      postChannelId: $('#c-post').value || null,
      mirrorType: $('#c-mtype').value,
    };
    const t = $('#c-mtarget');
    if (t) payload.mirrorTarget = t.value; // blank => keep existing (server COALESCE) except for slack where blank keeps
    const btn = $('#c-save');
    btn.disabled = true;
    try {
      await api(`/api/guilds/${guildId}/connect`, { method: 'POST', body: JSON.stringify(payload) });
      toast('Server connection saved', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- command log ----------
let logLoading = false;
async function loadLog() {
  if (logLoading) return;
  logLoading = true;
  const guildId = $('#log-guild').value;
  const status = $('#log-status').value;
  const qs = new URLSearchParams();
  if (guildId) qs.set('guildId', guildId);
  if (status) qs.set('status', status);
  qs.set('limit', '100');
  try {
    const { interactions } = await api('/api/interactions?' + qs.toString());
    renderLog(interactions);
  } catch (err) {
    $('#log-body').innerHTML = `<tr><td colspan="8" class="empty error-text">${esc(err.message)}</td></tr>`;
  } finally {
    logLoading = false;
  }
}

function guildName(id) {
  const g = state.guilds.find((x) => x.id === id);
  return g ? g.name || id : id || '—';
}

function renderLog(rows) {
  const body = $('#log-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No interactions yet. Run a slash command in Discord.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const result = r.result || {};
      const triage =
        r.command_name === 'report' && result.tag
          ? `<span class="badge ${result.priority}">${esc(result.priority)}</span> <span class="badge pill">${esc(result.tag)}</span>`
          : '<span class="muted">—</span>';
      const retryBtn = r.status === 'failed' && r.command_name === 'report'
        ? `<button class="btn small danger" data-retry="${esc(r.id)}">Retry</button>`
        : '';
      return `<tr class="log-row" data-id="${esc(r.id)}">
        <td class="muted" title="${esc(r.created_at)}">${relTime(r.created_at)}</td>
        <td>${esc(guildName(r.guild_id))}</td>
        <td><code>/${esc(r.command_name)}</code></td>
        <td>${esc(r.username || '—')}</td>
        <td>${esc(truncate(r.input, 40)) || '<span class="muted">—</span>'}</td>
        <td>${triage}</td>
        <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
        <td style="white-space:nowrap;">${retryBtn} <button class="btn small secondary" data-expand="${esc(r.id)}">Details</button></td>
      </tr>
      <tr class="detail-row" id="detail-${esc(r.id)}" style="display:none;"><td colspan="8"><div class="detail-inner" id="detail-inner-${esc(r.id)}"></div></td></tr>`;
    })
    .join('');
}

// event delegation for log actions
$('#log-body').addEventListener('click', async (e) => {
  const expandBtn = e.target.closest('[data-expand]');
  const retryBtn = e.target.closest('[data-retry]');
  if (expandBtn) {
    const id = expandBtn.dataset.expand;
    const row = $(`#detail-${CSS.escape(id)}`);
    if (row.style.display === 'none') {
      row.style.display = '';
      const inner = $(`#detail-inner-${CSS.escape(id)}`);
      inner.innerHTML = '<span class="spinner"></span> Loading actions…';
      try {
        const { actions } = await api(`/api/interactions/${id}/actions`);
        inner.innerHTML = renderActions(actions);
      } catch (err) {
        inner.innerHTML = `<span class="error-text">${esc(err.message)}</span>`;
      }
    } else {
      row.style.display = 'none';
    }
  }
  if (retryBtn) {
    const id = retryBtn.dataset.retry;
    retryBtn.disabled = true;
    retryBtn.textContent = 'Retrying…';
    try {
      const { status } = await api(`/api/interactions/${id}/retry`, { method: 'POST' });
      toast(`Retry finished: ${status}`, status === 'completed' ? 'success' : 'error');
      loadLog();
    } catch (err) {
      toast(err.message, 'error');
      retryBtn.disabled = false;
      retryBtn.textContent = 'Retry';
    }
  }
});

function renderActions(actions) {
  if (!actions.length) return '<span class="muted">No action steps recorded.</span>';
  return actions
    .slice()
    .reverse()
    .map((a) => {
      const detail = a.error
        ? `<span class="error-text">${esc(a.error)}</span>`
        : esc(a.detail ? JSON.stringify(a.detail) : '');
      return `<div class="step">
        <span class="s-name">${esc(a.step)}</span>
        <span class="s-status ${esc(a.status)}">${esc(a.status)}</span>
        <span class="s-detail">${detail}${a.attempts > 1 ? ` <span class="muted">(${a.attempts} attempts)</span>` : ''}</span>
      </div>`;
    })
    .join('');
}

$('#refresh-log').addEventListener('click', loadLog);
$('#log-guild').addEventListener('change', loadLog);
$('#log-status').addEventListener('change', loadLog);

setInterval(() => {
  if (state.currentTab === 'log' && $('#autorefresh').checked) loadLog();
}, 4000);

// ---------- configuration ----------
$('#config-guild').addEventListener('change', loadConfigForSelected);

async function loadConfigForSelected() {
  const guildId = $('#config-guild').value;
  const area = $('#config-area');
  if (!guildId) {
    area.innerHTML = '<p class="muted">No server selected.</p>';
    return;
  }
  area.innerHTML = '<p class="muted"><span class="spinner"></span> Loading config…</p>';
  try {
    const data = await api(`/api/guilds/${guildId}/config`);
    renderConfigForm(guildId, data.effective);
  } catch (err) {
    area.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
  }
}

function renderConfigForm(guildId, eff) {
  const s = eff.commands.status;
  const r = eff.commands.report;
  $('#config-area').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">/status</div>
      <label class="inline"><input type="checkbox" id="s-enabled" ${s.enabled !== false ? 'checked' : ''} /> Enabled</label>
      <label class="inline" style="margin-top:8px;"><input type="checkbox" id="s-ephemeral" ${s.ephemeral ? 'checked' : ''} /> Ephemeral reply (only the user sees it)</label>
    </div>

    <div class="card">
      <div class="section-title" style="margin-top:0;">/report</div>
      <div class="row">
        <label class="inline"><input type="checkbox" id="r-enabled" ${r.enabled !== false ? 'checked' : ''} /> Enabled</label>
        <label class="inline"><input type="checkbox" id="r-useai" ${r.useAI ? 'checked' : ''} /> Use AI triage</label>
        <label class="inline"><input type="checkbox" id="r-post" ${r.postToChannel ? 'checked' : ''} /> Post to channel</label>
        <label class="inline"><input type="checkbox" id="r-mirror" ${r.mirror ? 'checked' : ''} /> Mirror to 2nd channel</label>
      </div>
      <div class="row" style="margin-top:14px;">
        <label class="field"><span>Default label</span><input id="r-deflabel" value="${esc(r.defaultLabel || 'general')}" /></label>
        <label class="field"><span>Default priority</span>
          <select id="r-defpri">
            ${['low', 'medium', 'high'].map((p) => `<option ${r.defaultPriority === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select></label>
      </div>

      <div class="section-title" style="font-size:14px;">Keyword rules <span class="hint">if the report text contains the keyword, it gets this label + priority (highest match wins)</span></div>
      <div id="rules-list">
        ${(r.rules || []).map((rule, i) => ruleRowHtml(rule, i)).join('')}
      </div>
      <button class="btn secondary small" id="add-rule">+ Add rule</button>
      <hr style="border:none; border-top:1px solid var(--border); margin:18px 0;" />
      <button class="btn" id="save-config">Save configuration</button>
    </div>`;

  $('#add-rule').addEventListener('click', () => {
    const list = $('#rules-list');
    list.insertAdjacentHTML('beforeend', ruleRowHtml({ keyword: '', label: '', priority: 'medium' }, Date.now()));
  });
  $('#rules-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delrule]');
    if (del) del.closest('.rule-row').remove();
  });
  $('#save-config').addEventListener('click', () => saveConfig(guildId));
}

function ruleRowHtml(rule, i) {
  return `<div class="rule-row" data-rule>
    <input placeholder="keyword" value="${esc(rule.keyword || '')}" data-k />
    <input placeholder="label" value="${esc(rule.label || '')}" data-l />
    <select data-p>${['low', 'medium', 'high'].map((p) => `<option ${rule.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <button class="btn small danger" data-delrule="${i}">✕</button>
  </div>`;
}

async function saveConfig(guildId) {
  const rules = $$('#rules-list .rule-row')
    .map((row) => ({
      keyword: $('[data-k]', row).value.trim(),
      label: $('[data-l]', row).value.trim() || 'general',
      priority: $('[data-p]', row).value,
    }))
    .filter((r) => r.keyword);

  const config = {
    commands: {
      status: {
        enabled: $('#s-enabled').checked,
        ephemeral: $('#s-ephemeral').checked,
      },
      report: {
        enabled: $('#r-enabled').checked,
        useAI: $('#r-useai').checked,
        postToChannel: $('#r-post').checked,
        mirror: $('#r-mirror').checked,
        defaultLabel: $('#r-deflabel').value.trim() || 'general',
        defaultPriority: $('#r-defpri').value,
        rules,
      },
    },
  };
  const btn = $('#save-config');
  btn.disabled = true;
  try {
    await api(`/api/guilds/${guildId}/config`, { method: 'PUT', body: JSON.stringify({ config }) });
    toast('Configuration saved', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- boot ----------
(async function init() {
  try {
    await api('/api/auth/me');
  } catch {
    return; // api() already redirected to /login on 401
  }
  await loadOverview();
})();
