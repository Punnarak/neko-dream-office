// In-memory state for every Claude Code session we have heard from.
// Status only changes in response to a real hook event.

import path from 'node:path';
import { clean, str, summarizeTool, toolCategory, displayToolName } from './sanitize.js';

const FEED_LIMIT = 100;
const MAX_SESSIONS = 30;
const ENDED_TTL_MS = 30 * 60 * 1000;

export const KNOWN_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'StopFailure', 'SessionEnd',
];

export class OfficeState {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.sessions = new Map();
    this.feed = [];
    this.seq = 0;
    this.startedAt = now();
    this.eventCount = 0;
  }

  snapshot() {
    return {
      serverStartedAt: this.startedAt,
      eventCount: this.eventCount,
      sessions: [...this.sessions.values()].map(publicSession),
      feed: this.feed,
    };
  }

  // Returns { session, item } for broadcast, or null when the payload is unusable.
  apply(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const event = raw.hook_event_name;
    const sessionId = str(raw.session_id, 80);
    if (!KNOWN_EVENTS.includes(event) || !sessionId) return null;

    const at = this.now();
    const s = this.#session(sessionId, raw, at);
    s.lastEventAt = at;
    s.lastEvent = event;
    this.eventCount++;

    // Only subagent events carry agent_id; anything without one belongs to the main agent.
    const agentId = str(raw.agent_id, 80);
    const agentType = str(raw.agent_type, 40);
    const owner = agentId || 'main';
    let label;
    let detail;
    let tool;
    let level = 'info';

    switch (event) {
      case 'SessionStart':
        s.source = str(raw.source, 20);
        if (raw.model) s.model = str(typeof raw.model === 'string' ? raw.model : raw.model?.id, 60);
        s.endReason = undefined;
        s.tools.clear();
        s.subagents.clear();
        setStatus(s, 'idle', at);
        label = `เริ่ม session (${s.source || 'startup'})`;
        break;

      case 'UserPromptSubmit':
        s.prompts++;
        s.tools.clear();
        setStatus(s, 'working', at);
        label = 'ได้รับคำสั่งใหม่';
        detail = typeof raw.prompt === 'string' ? `${[...raw.prompt].length} ตัวอักษร (ไม่แสดงเนื้อหา)` : undefined;
        break;

      case 'PreToolUse': {
        const name = str(raw.tool_name, 120) || 'unknown';
        tool = {
          id: str(raw.tool_use_id, 80) || `t${++this.seq}`,
          name: displayToolName(name),
          category: toolCategory(name),
          summary: summarizeTool(name, raw.tool_input),
          agentId: owner,
          agentType,
          startedAt: at,
        };
        s.tools.set(tool.id, tool);
        s.toolCalls++;
        const agent = this.#agent(s, agentId, agentType, at, true);
        agent.lastEventAt = at;
        agent.toolCalls++;
        setStatus(s, 'tool', at);
        label = `ใช้ ${tool.name}`;
        detail = tool.summary;
        break;
      }

      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const name = str(raw.tool_name, 120) || 'unknown';
        const id = str(raw.tool_use_id, 80);
        const started = id && s.tools.get(id);
        if (id) s.tools.delete(id);
        else for (const [k, t] of s.tools) if (t.name === displayToolName(name) && t.agentId === owner) { s.tools.delete(k); break; }
        const agent = this.#agent(s, agentId, agentType, at, false);
        if (agent) agent.lastEventAt = at;
        tool = {
          name: displayToolName(name),
          category: toolCategory(name),
          summary: started?.summary ?? summarizeTool(name, raw.tool_input),
          agentType,
          ms: started ? at - started.startedAt : undefined,
        };
        if (event === 'PostToolUse') {
          setStatus(s, s.tools.size ? 'tool' : 'working', at);
          label = `${tool.name} ทำงานเสร็จ`;
          detail = tool.summary;
        } else if (raw.is_interrupt) {
          setStatus(s, 'interrupted', at);
          label = `${tool.name} ถูกขัดจังหวะ`;
          level = 'warn';
        } else {
          const message = errorHead(raw.error);
          s.lastError = { at, tool: tool.name, message };
          setStatus(s, 'error', at);
          label = `${tool.name} ล้มเหลว`;
          detail = message;
          level = 'error';
        }
        break;
      }

      case 'SubagentStart':
        if (agentId) {
          const prev = s.subagents.get(agentId);
          s.subagents.set(agentId, { type: agentType || prev?.type || 'subagent', startedAt: at, lastEventAt: at, toolCalls: prev?.toolCalls ?? 0, usage: prev?.usage });
        }
        if (s.status !== 'tool') setStatus(s, 'working', at);
        label = `subagent เริ่ม: ${agentType || 'unknown'}`;
        break;

      case 'SubagentStop':
        if (agentId) {
          s.subagents.delete(agentId);
          for (const [k, t] of s.tools) if (t.agentId === agentId) s.tools.delete(k);
          if (s.status === 'tool' && !s.tools.size) setStatus(s, 'working', at);
        }
        label = `subagent หยุด: ${agentType || 'unknown'}`;
        break;

      case 'Notification': {
        const type = str(raw.notification_type, 40);
        if (type === 'permission_prompt') setStatus(s, 'waiting', at);
        else if (type === 'idle_prompt') setStatus(s, 'idle', at);
        label = type === 'permission_prompt' ? 'รอการอนุญาตจากคุณ'
          : type === 'idle_prompt' ? 'รอคำสั่งจากคุณ'
          : 'แจ้งเตือน';
        detail = clean(raw.message, 120) || undefined;
        level = type === 'permission_prompt' ? 'warn' : 'info';
        break;
      }

      case 'Stop':
        s.tools.clear();
        s.subagents.clear();
        setStatus(s, 'completed', at);
        label = 'ตอบจบเทิร์น รอคำสั่งถัดไป';
        break;

      case 'StopFailure': {
        const message = clean(str(raw.error_type ?? raw.error, 200) ?? '') || 'API error';
        s.tools.clear();
        s.subagents.clear();
        s.lastError = { at, tool: undefined, message };
        setStatus(s, 'error', at);
        label = 'เทิร์นจบเพราะข้อผิดพลาด';
        detail = message;
        level = 'error';
        break;
      }

      case 'SessionEnd':
        s.endReason = str(raw.reason, 40);
        s.tools.clear();
        s.subagents.clear();
        setStatus(s, 'stopped', at);
        label = `ปิด session (${s.endReason || 'unknown'})`;
        break;
    }

    const item = {
      id: ++this.seq,
      at,
      sessionId,
      project: s.project,
      event,
      label,
      detail,
      level,
      category: tool?.category,
      agentType,
    };
    this.feed.push(item);
    if (this.feed.length > FEED_LIMIT) this.feed.splice(0, this.feed.length - FEED_LIMIT);
    this.#prune(at);
    return { session: publicSession(s), item };
  }

  // Real token totals for one agent, read from its transcript by UsageTracker.
  // Returns the public session to broadcast, or null when that agent is not in the office.
  setUsage(sessionId, agentKey, totals) {
    const s = this.sessions.get(sessionId);
    if (!s || !totals) return null;
    const a = agentKey === 'main' ? s.main : s.subagents.get(agentKey);
    if (!a) return null;
    a.usage = {
      total: totals.total, input: totals.input, output: totals.output,
      cacheCreation: totals.cacheCreation, cacheRead: totals.cacheRead, messages: totals.messages,
      at: this.now(),
    };
    return publicSession(s);
  }

  // The Redmine ticket ClaudeTime thinks this session works on ({ id, source } or null).
  setTicket(sessionId, ticket) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    s.ticket = ticket || undefined;
    return publicSession(s);
  }

  publicSession(sessionId) {
    const s = this.sessions.get(sessionId);
    return s ? publicSession(s) : null;
  }

  #session(id, raw, at) {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        project: undefined,
        createdAt: at,
        status: 'idle',
        statusSince: at,
        tools: new Map(),
        subagents: new Map(),
        main: { lastEventAt: at, toolCalls: 0 },
        prompts: 0,
        toolCalls: 0,
        lastError: undefined,
      };
      this.sessions.set(id, s);
    }
    if (typeof raw.cwd === 'string' && raw.cwd) s.project = path.basename(raw.cwd).slice(0, 60);
    if (typeof raw.permission_mode === 'string') s.permissionMode = str(raw.permission_mode, 30);
    return s;
  }

  // The agent that owns an event. A tool event with an agent_id we have not seen
  // (e.g. its SubagentStart came before a backend restart) is still a real agent,
  // so PreToolUse may add it — with an unknown start time. PostToolUse never adds.
  #agent(s, agentId, agentType, at, create) {
    if (!agentId) return s.main;
    let a = s.subagents.get(agentId);
    if (!a && create) {
      a = { type: agentType || 'subagent', startedAt: undefined, firstSeenAt: at, lastEventAt: at, toolCalls: 0 };
      s.subagents.set(agentId, a);
    }
    return a;
  }

  #prune(at) {
    for (const [id, s] of this.sessions) {
      if (s.status === 'stopped' && at - s.lastEventAt > ENDED_TTL_MS) this.sessions.delete(id);
    }
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastEventAt - b.lastEventAt);
      for (const s of oldest.slice(0, this.sessions.size - MAX_SESSIONS)) this.sessions.delete(s.id);
    }
  }
}

// Tool errors often embed command output; keep only the first two non-empty lines.
function errorHead(err) {
  const text = typeof err === 'string' ? err : JSON.stringify(err ?? '');
  return clean(text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 2).join(' · '), 160);
}

function setStatus(s, status, at) {
  if (s.status !== status) {
    s.status = status;
    s.statusSince = at;
  }
}

function publicSession(s) {
  return {
    id: s.id,
    project: s.project,
    model: s.model,
    source: s.source,
    permissionMode: s.permissionMode,
    status: s.status,
    statusSince: s.statusSince,
    createdAt: s.createdAt,
    lastEventAt: s.lastEventAt,
    lastEvent: s.lastEvent,
    endReason: s.endReason,
    prompts: s.prompts,
    toolCalls: s.toolCalls,
    tools: [...s.tools.values()],
    subagents: [...s.subagents.entries()].map(([id, a]) => ({ id, ...a })),
    agents: publicAgents(s),
    lastError: s.lastError,
    ticket: s.ticket ?? null,
  };
}

// The main agent plus each live subagent, with the tool it is running right now.
// A stopped session has no agents. Only names, categories and short summaries — never prompts or output.
function publicAgents(s) {
  if (s.status === 'stopped') return [];
  const running = [...s.tools.values()];
  const one = (id, a) => {
    const mine = running.filter((t) => t.agentId === id);
    const t = mine.reduce((x, y) => (y.startedAt >= (x?.startedAt ?? 0) ? y : x), undefined);
    return {
      id,
      type: a.type,
      main: id === 'main',
      startedAt: a.startedAt,
      firstSeenAt: a.firstSeenAt,
      lastEventAt: a.lastEventAt,
      toolCalls: a.toolCalls,
      usage: a.usage ?? null, // null = not known yet (never estimated)
      running: mine.length,
      tool: t ? { name: t.name, category: t.category, summary: t.summary, startedAt: t.startedAt } : null,
    };
  };
  return [
    one('main', { type: 'main', startedAt: s.createdAt, ...s.main }),
    ...[...s.subagents.entries()].map(([id, a]) => one(id, a)),
  ];
}
