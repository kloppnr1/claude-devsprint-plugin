#!/usr/bin/env node

/**
 * DevSprint Dashboard — Local web server for sprint visibility
 *
 * Usage: node dashboard/server.cjs [--port 3000] [--cwd <path>]
 *
 * Serves a web dashboard showing:
 *   - Live sprint board from the configured provider (Azure DevOps or GitHub)
 *   - Execution history and PR status
 *   - Git activity across target repos
 *   - Daily activity summary
 *
 * Data is fetched via MCP servers (no direct API calls):
 *   - Azure DevOps: stdio MCP server (@azure-devops/mcp)
 *   - GitHub: HTTP MCP server (api.githubcopilot.com/mcp/)
 *
 * Uses ONLY Node.js built-ins (http, https, fs, path, child_process).
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const PORT = parseInt(getArg('--port', '3000'), 10);
const CWD = getArg('--cwd', process.cwd());

// ─── Config ───────────────────────────────────────────────────────────────────

let cachedConfig = null;

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.planning', 'devsprint-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No config found at ${configPath}. Run /devsprint-setup first.`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // New multi-provider format: { provider, github: {...}, azdo: {...} }
  if (raw.provider) {
    const cfg = { provider: raw.provider };

    if (raw.azdo) {
      cfg.org = raw.azdo.org;
      cfg.project = raw.azdo.project;
      cfg.team = raw.azdo.team || null;
      cfg.area = raw.azdo.area || null;
      cfg.assignee = raw.azdo.assignee || null;
      // PAT kept for backwards compat (dashboard server can still use it for legacy fallback)
      if (raw.azdo.pat) {
        const decoded = Buffer.from(raw.azdo.pat, 'base64').toString('utf-8');
        cfg.pat = decoded.startsWith(':') ? decoded.slice(1) : decoded;
      }
    }

    if (raw.github) {
      cfg.githubOwner = raw.github.owner;
      cfg.githubRepo = raw.github.repo;
      cfg.githubAssignee = raw.github.assignee || null;
    }

    return cfg;
  }

  // Legacy format: flat { org, project, team, area, pat }
  const decoded = Buffer.from(raw.pat, 'base64').toString('utf-8');
  const rawPat = decoded.startsWith(':') ? decoded.slice(1) : decoded;
  return {
    provider: 'azdo',
    org: raw.org,
    project: raw.project,
    pat: rawPat,
    team: raw.team || null,
    area: raw.area || null,
  };
}

function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig(CWD);
  return cachedConfig;
}

// ─── MCP stdio Client (Azure DevOps) ─────────────────────────────────────────
//
// Spawns `npx -y @azure-devops/mcp <org>` and communicates over stdin/stdout
// using newline-delimited JSON-RPC 2.0.

let azdoMcpProcess = null;
let azdoMcpReady = false;
let azdoMcpQueue = [];      // pending { resolve, reject, id } waiting for responses
let azdoMcpBuffer = '';     // partial line buffer
let azdoMcpNextId = 1;

function getAzdoOrgName(cfg) {
  // org may be a full URL like https://verdo365.visualstudio.com
  const orgUrl = cfg.org || '';
  const match = orgUrl.match(/https?:\/\/([^.]+)\.visualstudio\.com/);
  if (match) return match[1];
  // Could also be dev.azure.com/<org>
  const devMatch = orgUrl.match(/dev\.azure\.com\/([^/]+)/);
  if (devMatch) return devMatch[1];
  // Assume it's already a bare org name
  return orgUrl.replace(/\/$/, '');
}

function startAzdoMcp(cfg) {
  if (azdoMcpProcess) return;

  const orgName = getAzdoOrgName(cfg);
  console.log(`[mcp/azdo] Starting @azure-devops/mcp for org: ${orgName}`);

  azdoMcpProcess = spawn('npx', ['-y', '@azure-devops/mcp', orgName], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  azdoMcpProcess.stderr.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.error(`[mcp/azdo stderr] ${msg}`);
  });

  azdoMcpProcess.stdout.on('data', (chunk) => {
    azdoMcpBuffer += chunk.toString();
    const lines = azdoMcpBuffer.split('\n');
    azdoMcpBuffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { continue; }

      // Match response to a pending call by id
      if (msg.id !== undefined) {
        const idx = azdoMcpQueue.findIndex(q => q.id === msg.id);
        if (idx !== -1) {
          const { resolve, reject } = azdoMcpQueue.splice(idx, 1)[0];
          if (msg.error) {
            reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            resolve(msg.result);
          }
        }
      }
    }
  });

  azdoMcpProcess.on('exit', (code) => {
    console.log(`[mcp/azdo] Process exited with code ${code}`);
    azdoMcpProcess = null;
    azdoMcpReady = false;
    // Reject all pending calls
    for (const q of azdoMcpQueue) q.reject(new Error('MCP process exited'));
    azdoMcpQueue = [];
  });
}

function sendAzdoRpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!azdoMcpProcess) {
      return reject(new Error('Azure DevOps MCP process not started'));
    }
    const id = azdoMcpNextId++;
    azdoMcpQueue.push({ id, resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    azdoMcpProcess.stdin.write(msg);
  });
}

async function initAzdoMcp(cfg) {
  if (azdoMcpReady) return;
  startAzdoMcp(cfg);

  // Send initialize
  await sendAzdoRpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'devsprint-dashboard', version: '1.0' },
  });

  // Send initialized notification (no response expected)
  const notif = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n';
  azdoMcpProcess.stdin.write(notif);

  azdoMcpReady = true;
  console.log('[mcp/azdo] Initialized');
}

async function callAzdoTool(toolName, toolArgs) {
  const cfg = getConfig();
  await initAzdoMcp(cfg);
  const result = await sendAzdoRpc('tools/call', { name: toolName, arguments: toolArgs });
  // MCP tools/call result: { content: [{ type: 'text', text: '...' }], isError?: bool }
  if (result && result.isError) {
    const errText = result.content && result.content[0] ? result.content[0].text : 'Unknown MCP tool error';
    throw new Error(`MCP tool error (${toolName}): ${errText}`);
  }
  const text = result && result.content && result.content[0] ? result.content[0].text : '';
  try { return JSON.parse(text); } catch { return text; }
}

// ─── MCP HTTP Client (GitHub) ─────────────────────────────────────────────────
//
// Uses the Streamable HTTP transport at https://api.githubcopilot.com/mcp/
// Auth token obtained via `gh auth token`.

let githubToken = null;
let githubMcpSessionId = null;
let githubMcpNextId = 1;

function getGithubToken() {
  if (githubToken) return githubToken;
  try {
    githubToken = execSync('gh auth token', { encoding: 'utf-8', timeout: 5000 }).trim();
    return githubToken;
  } catch {
    throw new Error('Could not get GitHub token via `gh auth token`. Run `gh auth login` first.');
  }
}

function httpPost(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const bodyStr = JSON.stringify(bodyObj);
    const reqHeaders = Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    }, headers);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: reqHeaders,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function initGithubMcp() {
  if (githubMcpSessionId) return;

  const token = getGithubToken();
  const id = githubMcpNextId++;
  const res = await httpPost(
    'https://api.githubcopilot.com/mcp/',
    {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json, text/event-stream',
    },
    { jsonrpc: '2.0', id, method: 'initialize', params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'devsprint-dashboard', version: '1.0' },
    }}
  );

  if (res.status !== 200) {
    throw new Error(`GitHub MCP init failed: HTTP ${res.status} — ${res.body}`);
  }

  // Capture session id from response headers if provided
  if (res.headers['mcp-session-id']) {
    githubMcpSessionId = res.headers['mcp-session-id'];
  } else {
    githubMcpSessionId = 'default'; // fallback marker so we don't re-init
  }

  console.log(`[mcp/github] Initialized (session: ${githubMcpSessionId})`);
}

async function callGithubTool(toolName, toolArgs) {
  await initGithubMcp();
  const token = getGithubToken();
  const id = githubMcpNextId++;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json, text/event-stream',
  };
  if (githubMcpSessionId && githubMcpSessionId !== 'default') {
    headers['mcp-session-id'] = githubMcpSessionId;
  }

  const res = await httpPost(
    'https://api.githubcopilot.com/mcp/',
    headers,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: toolArgs } }
  );

  if (res.status !== 200) {
    throw new Error(`GitHub MCP tool call failed: HTTP ${res.status} — ${res.body.slice(0, 200)}`);
  }

  // Response may be SSE or plain JSON
  let parsed;
  const body = res.body.trim();

  if (body.startsWith('data:')) {
    // SSE format: extract last data line
    const dataLines = body.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
    const lastData = dataLines[dataLines.length - 1];
    try { parsed = JSON.parse(lastData); } catch { throw new Error(`GitHub MCP SSE parse error: ${lastData}`); }
  } else {
    try { parsed = JSON.parse(body); } catch { throw new Error(`GitHub MCP response parse error: ${body.slice(0, 200)}`); }
  }

  if (parsed.error) {
    throw new Error(`GitHub MCP error ${parsed.error.code}: ${parsed.error.message}`);
  }

  const result = parsed.result;
  if (result && result.isError) {
    const errText = result.content && result.content[0] ? result.content[0].text : 'Unknown';
    throw new Error(`GitHub MCP tool error (${toolName}): ${errText}`);
  }

  const text = result && result.content && result.content[0] ? result.content[0].text : '';
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Unified MCP dispatcher ───────────────────────────────────────────────────

async function callMcpTool(toolName, toolArgs) {
  const cfg = getConfig();
  const provider = cfg.provider || 'azdo';

  if (provider === 'github') {
    return callGithubTool(toolName, toolArgs);
  } else {
    return callAzdoTool(toolName, toolArgs);
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Data Fetchers ────────────────────────────────────────────────────────────

async function fetchSprintData() {
  const cfg = getConfig();
  const provider = cfg.provider || 'azdo';

  if (provider === 'github') {
    return fetchSprintDataGithub(cfg);
  } else {
    return fetchSprintDataAzdo(cfg);
  }
}

// Azure DevOps sprint data via MCP
async function fetchSprintDataAzdo(cfg) {
  const project = cfg.project;
  const team = cfg.team || project;

  // 1. Get current iteration
  let iterations;
  try {
    iterations = await callAzdoTool('ado_work_list_team_iterations', {
      project,
      team,
      timeframe: 'current',
    });
  } catch (err) {
    throw new Error(`Failed to get iterations: ${err.message}`);
  }

  const iterList = Array.isArray(iterations) ? iterations : (iterations && iterations.value ? iterations.value : []);
  if (iterList.length === 0) throw new Error('No active sprint');
  const iteration = iterList[0];

  // 2. Get work items for the iteration
  let iterItems;
  try {
    iterItems = await callAzdoTool('ado_wit_get_work_items_for_iteration', {
      project,
      team,
      iterationId: iteration.id || iteration.path,
    });
  } catch (err) {
    throw new Error(`Failed to get iteration work items: ${err.message}`);
  }

  // 3. Also get "my work items" to scope to current user
  let myItems = [];
  try {
    myItems = await callAzdoTool('ado_wit_my_work_items', {});
  } catch { /* optional — proceed with all items */ }

  const myItemIds = new Set(
    Array.isArray(myItems) ? myItems.map(i => i.id || i.workItemId) :
    (myItems && myItems.value ? myItems.value.map(i => i.id || i.workItemId) : [])
  );

  // Normalize the iteration items
  const rawItems = Array.isArray(iterItems) ? iterItems :
    (iterItems && iterItems.workItems ? iterItems.workItems :
    (iterItems && iterItems.value ? iterItems.value : []));

  const allItems = rawItems.map((item) => {
    const fields = item.fields || item;
    const assignedTo = fields['System.AssignedTo'] || fields.assignedTo;
    return {
      id: item.id || fields['System.Id'],
      type: fields['System.WorkItemType'] || fields.workItemType || 'Unknown',
      title: fields['System.Title'] || fields.title || '',
      state: fields['System.State'] || fields.state || '',
      description: stripHtml(fields['System.Description'] || fields.description || ''),
      parentId: fields['System.Parent'] || fields.parentId || null,
      assignedTo: typeof assignedTo === 'object' ? assignedTo?.displayName : assignedTo || null,
      tags: fields['System.Tags'] ? fields['System.Tags'].split('; ') : [],
      changedDate: fields['System.ChangedDate'] || fields.changedDate || null,
      createdDate: fields['System.CreatedDate'] || fields.createdDate || null,
    };
  });

  // Filter to current user's items if we have myItems data
  let items = allItems;
  if (myItemIds.size > 0) {
    const myIds = new Set(allItems.filter(i => myItemIds.has(i.id)).map(i => i.id));
    const myParentIds = new Set(allItems.filter(i => myIds.has(i.id) && i.parentId).map(i => i.parentId));
    const myChildIds = new Set(allItems.filter(i => myIds.has(i.parentId)).map(i => i.id));
    const allMyIds = new Set([...myIds, ...myParentIds, ...myChildIds]);
    if (allMyIds.size > 0) items = allItems.filter(i => allMyIds.has(i.id));
  }

  return {
    sprint: {
      name: iteration.name,
      path: iteration.path,
      startDate: iteration.attributes?.startDate || null,
      finishDate: iteration.attributes?.finishDate || null,
    },
    items,
  };
}

// GitHub sprint data via MCP
// Convention: milestones = sprints, issues with milestone = sprint items
async function fetchSprintDataGithub(cfg) {
  const owner = cfg.githubOwner;
  const repo = cfg.githubRepo;
  const assignee = cfg.githubAssignee;

  // 1. List milestones to find the active one (first open milestone)
  let milestones;
  try {
    milestones = await callGithubTool('list_milestones', { owner, repo, state: 'open' });
  } catch (err) {
    throw new Error(`Failed to list GitHub milestones: ${err.message}`);
  }

  const milestoneList = Array.isArray(milestones) ? milestones : (milestones && milestones.milestones ? milestones.milestones : []);
  if (milestoneList.length === 0) {
    return { sprint: { name: 'No active milestone', path: '', startDate: null, finishDate: null }, items: [] };
  }

  // Use first open milestone as current "sprint"
  const milestone = milestoneList[0];

  // 2. List issues in the milestone
  const issueParams = { owner, repo, milestone: String(milestone.number), state: 'all' };
  if (assignee) issueParams.assignee = assignee;

  let issues;
  try {
    issues = await callGithubTool('list_issues', issueParams);
  } catch (err) {
    throw new Error(`Failed to list GitHub issues: ${err.message}`);
  }

  const issueList = Array.isArray(issues) ? issues : (issues && issues.issues ? issues.issues : []);

  const items = issueList.map((issue) => ({
    id: issue.number,
    type: issue.pull_request ? 'Pull Request' : 'Issue',
    title: issue.title || '',
    state: issue.state === 'open' ? 'Active' : 'Closed',
    description: issue.body || '',
    parentId: null,
    assignedTo: issue.assignee ? issue.assignee.login : (issue.assignees && issue.assignees[0] ? issue.assignees[0].login : null),
    tags: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name),
    changedDate: issue.updated_at || null,
    createdDate: issue.created_at || null,
  }));

  return {
    sprint: {
      name: milestone.title,
      path: `${owner}/${repo}#${milestone.number}`,
      startDate: milestone.created_at || null,
      finishDate: milestone.due_on || null,
    },
    items,
  };
}

// ─── PR Status ────────────────────────────────────────────────────────────────

async function fetchPRStatus() {
  const cfg = getConfig();
  const provider = cfg.provider || 'azdo';

  if (provider === 'github') {
    return fetchPRStatusGithub(cfg);
  } else {
    return fetchPRStatusAzdo(cfg);
  }
}

async function fetchPRStatusAzdo(cfg) {
  const execLog = getExecutionLog();
  if (!execLog || !execLog.executions) return [];

  const project = cfg.project;
  const results = [];

  // Get all PRs once per repo to avoid N+1 calls
  const repoPrCache = {};

  for (const exec of execLog.executions) {
    if (!exec.prId || !exec.prUrl) continue;
    // Extract repo name from PR URL
    const match = exec.prUrl.match(/_git\/([^/]+)\/pullRequest/);
    if (!match) continue;
    const repoName = match[1];

    try {
      if (!repoPrCache[repoName]) {
        repoPrCache[repoName] = await callAzdoTool('ado_repo_list_pull_requests_by_repo_or_project', {
          project,
          repositoryId: repoName,
          status: 'all',
        });
      }
      const prList = repoPrCache[repoName];
      const prArr = Array.isArray(prList) ? prList : (prList && prList.value ? prList.value : []);
      const pr = prArr.find(p => p.pullRequestId === exec.prId || p.pullRequestId === Number(exec.prId));

      if (pr) {
        results.push({
          storyId: exec.storyId,
          storyTitle: exec.storyTitle,
          prId: exec.prId,
          prUrl: exec.prUrl,
          prTitle: pr.title,
          prStatus: pr.status,
          mergeStatus: pr.mergeStatus,
          reviewers: (pr.reviewers || []).map(r => ({
            name: r.displayName,
            vote: r.vote,
          })),
          creationDate: pr.creationDate,
          closedDate: pr.closedDate,
          repoName,
        });
      }
    } catch {}
  }

  return results;
}

async function fetchPRStatusGithub(cfg) {
  const execLog = getExecutionLog();
  if (!execLog || !execLog.executions) return [];

  const owner = cfg.githubOwner;
  const repo = cfg.githubRepo;
  const results = [];

  // Fetch all PRs once
  let allPRs = [];
  try {
    const prData = await callGithubTool('list_pull_requests', { owner, repo, state: 'all' });
    allPRs = Array.isArray(prData) ? prData : (prData && prData.pull_requests ? prData.pull_requests : []);
  } catch {}

  for (const exec of execLog.executions) {
    if (!exec.branch) continue;

    const pr = allPRs.find(p => p.head && p.head.ref === exec.branch);
    if (!pr) continue;

    results.push({
      storyId: exec.storyId,
      storyTitle: exec.storyTitle,
      prId: pr.number,
      prUrl: pr.html_url,
      prTitle: pr.title,
      prStatus: pr.state,
      mergeStatus: pr.merged ? 'succeeded' : (pr.mergeable ? 'clean' : 'conflicts'),
      reviewers: (pr.requested_reviewers || []).map(r => ({ name: r.login, vote: 0 })),
      creationDate: pr.created_at,
      closedDate: pr.closed_at,
      repoName: repo,
    });
  }

  return results;
}

// ─── Close Story ──────────────────────────────────────────────────────────────

async function closeStory(storyId) {
  const cfg = getConfig();
  const provider = cfg.provider || 'azdo';

  if (provider === 'github') {
    return closeStoryGithub(cfg, storyId);
  } else {
    return closeStoryAzdo(cfg, storyId);
  }
}

async function closeStoryAzdo(cfg, storyId) {
  const result = await callAzdoTool('ado_wit_update_work_item', {
    id: Number(storyId),
    patch: [{ op: 'add', path: '/fields/System.State', value: 'Closed' }],
  });
  return { status: 'updated', id: storyId, state: 'Closed', raw: result };
}

async function closeStoryGithub(cfg, storyId) {
  const owner = cfg.githubOwner;
  const repo = cfg.githubRepo;
  const result = await callGithubTool('update_issue', {
    owner,
    repo,
    issue_number: Number(storyId),
    state: 'closed',
  });
  return { status: 'updated', id: storyId, state: 'closed', raw: result };
}

// ─── Local File Helpers ───────────────────────────────────────────────────────

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return null; }
}

function getTaskMap() {
  return readJsonFile(path.join(CWD, '.planning', 'devsprint-task-map.json'));
}

function getExecutionLog() {
  return readJsonFile(path.join(CWD, '.planning', 'devsprint-execution-log.json'));
}

function getGitActivity() {
  const taskMap = getTaskMap();
  if (!taskMap) return [];

  const repos = new Set();
  for (const m of taskMap.mappings) {
    if (m.repoPath) repos.add(m.repoPath);
  }

  const results = [];
  for (const repoPath of repos) {
    if (!fs.existsSync(repoPath)) continue;
    const repoName = path.basename(repoPath);
    try {
      // Recent commits (last 7 days)
      const log = execSync(
        `git log --all --since="7 days ago" --format="%H|%s|%an|%ai|%D" --max-count=50`,
        { cwd: repoPath, encoding: 'utf-8', timeout: 10000 }
      ).trim();

      const commits = log ? log.split('\n').filter(Boolean).map(line => {
        const [hash, subject, author, date, refs] = line.split('|');
        return { hash, subject, author, date, refs: refs || '' };
      }) : [];

      // Current branch
      let currentBranch = '';
      try {
        currentBranch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
      } catch {}

      // Uncommitted changes
      let hasChanges = false;
      try {
        const status = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
        hasChanges = status.length > 0;
      } catch {}

      // Feature branches
      let branches = [];
      try {
        const branchOutput = execSync('git branch --list "feature/*"', { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
        branches = branchOutput ? branchOutput.split('\n').map(b => b.trim().replace(/^\* /, '')) : [];
      } catch {}

      results.push({ repoName, repoPath, currentBranch, hasChanges, commits, branches });
    } catch (err) {
      results.push({ repoName, repoPath, error: err.message, commits: [], branches: [] });
    }
  }

  return results;
}

function getAgentStatus() {
  return readJsonFile(path.join(CWD, '.planning', 'devsprint-agent-status.json'));
}

function isStoryRunning(storyId) {
  const status = getAgentStatus();
  if (!status || !status.active) return false;
  const sid = String(storyId);
  if (status.active.stories && status.active.stories[sid]) return true;
  if (String(status.active.storyId) === sid) return true;
  return false;
}

function seedAgentStatus(storyId, step, detail) {
  const statusPath = path.join(CWD, '.planning', 'devsprint-agent-status.json');
  let existing = { active: null, history: [] };
  try { if (fs.existsSync(statusPath)) existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8')); } catch {}
  const now = new Date().toISOString();
  const sid = parseInt(storyId, 10);
  if (!existing.active) {
    existing.active = { stories: {}, stepLog: [] };
  }
  const existingStories = existing.active.stories || {};
  existingStories[String(sid)] = {
    storyId: sid,
    storyTitle: null,
    step,
    detail,
    command: null,
    startedAt: now,
    updatedAt: now,
    stepLog: [{ step, detail, at: now, storyId: sid }],
  };
  existing.active.stories = existingStories;
  existing.active.storyId = sid;
  existing.active.step = step;
  existing.active.detail = detail;
  existing.active.updatedAt = now;
  if (!existing.active.startedAt) existing.active.startedAt = now;
  if (!existing.active.stepLog) existing.active.stepLog = [];
  existing.active.stepLog.push({ step, detail, at: now, storyId: sid });
  fs.writeFileSync(statusPath, JSON.stringify(existing, null, 2), 'utf-8');
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  // API routes
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    try {
      let data;

      // Parameterized routes: /api/questions/{id} and /api/answers/{id}
      const qMatch = pathname.match(/^\/api\/questions\/(\d+)$/);
      const aMatch = pathname.match(/^\/api\/answers\/(\d+)$/);
      if (qMatch) {
        const qDir = path.join(CWD, '.planning', 'questions');
        const qFile = path.join(qDir, qMatch[1] + '.json');
        data = readJsonFile(qFile);
        if (!data) { res.writeHead(404); res.end(JSON.stringify({ error: 'No questions' })); return; }
        res.writeHead(200); res.end(JSON.stringify(data)); return;
      }
      if (aMatch) {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          await new Promise(r => req.on('end', r));
          const aDir = path.join(CWD, '.planning', 'answers');
          if (!fs.existsSync(aDir)) fs.mkdirSync(aDir, { recursive: true });
          fs.writeFileSync(path.join(aDir, aMatch[1] + '.json'), body, 'utf-8');
          data = { status: 'saved', storyId: Number(aMatch[1]) };
          res.writeHead(200); res.end(JSON.stringify(data)); return;
        } else {
          res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
        }
      }

      switch (pathname) {
        case '/api/sprint':
          data = await fetchSprintData();
          break;
        case '/api/task-map':
          data = getTaskMap() || { mappings: [] };
          break;
        case '/api/execution-log':
          data = getExecutionLog() || { executions: [] };
          break;
        case '/api/git-activity':
          data = getGitActivity();
          break;
        case '/api/agent-status':
          data = getAgentStatus() || { active: null, history: [] };
          break;
        case '/api/pr-status':
          data = await fetchPRStatus();
          break;
        case '/api/story-spec': {
          const sid = new URL(req.url, 'http://localhost').searchParams.get('id');
          if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'id required' })); return; }
          const tm = getTaskMap();
          const mapping = tm && tm.mappings ? tm.mappings.find(m => m.storyId === Number(sid)) : null;
          if (!mapping || !mapping.repoPath) { res.writeHead(404); res.end(JSON.stringify({ error: 'Story not in task map' })); return; }
          const specPath = path.join(mapping.repoPath, '.planning', 'stories', sid + '.md');
          try { data = { markdown: fs.readFileSync(specPath, 'utf8'), repoPath: mapping.repoPath }; }
          catch { res.writeHead(404); res.end(JSON.stringify({ error: 'Spec not found at ' + specPath })); return; }
          break;
        }
        case '/api/execute':
          if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            await new Promise(r => req.on('end', r));
            const { storyId, comment } = JSON.parse(body);
            if (!storyId) { res.writeHead(400); res.end(JSON.stringify({ error: 'storyId required' })); return; }
            if (isStoryRunning(storyId)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Story #' + storyId + ' has an active run' })); return; }
            const ctxDir = path.join(CWD, '.planning', 'execution-context');
            const ctxFile = path.join(ctxDir, storyId + '.txt');
            if (comment && comment.trim()) {
              fs.mkdirSync(ctxDir, { recursive: true });
              fs.writeFileSync(ctxFile, comment.trim(), 'utf8');
            } else {
              try { fs.unlinkSync(ctxFile); } catch {}
            }
            seedAgentStatus(storyId, 'Starter', 'Initialiserer execute...');
            const { exec: execFn } = require('child_process');
            const execBat = path.join(CWD, '.planning', '_run_exec.bat');
            fs.writeFileSync(execBat, `@echo off\nset "CLAUDECODE="\ncd /d "${CWD}"\nclaude -p "/devsprint-execute ${storyId} --headless" --dangerously-skip-permissions --verbose\n`);
            execFn(`start /min cmd /c "${execBat}"`, { shell: true });
            data = { status: 'launched', storyId };
          } else {
            res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
          }
          break;
        case '/api/pr-fix':
          if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            await new Promise(r => req.on('end', r));
            const { storyId: prFixId, prId: prFixPrId, repoName: prFixRepo } = JSON.parse(body);
            if (!prFixId) { res.writeHead(400); res.end(JSON.stringify({ error: 'storyId required' })); return; }
            if (isStoryRunning(prFixId)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Story #' + prFixId + ' has an active run' })); return; }
            seedAgentStatus(prFixId, 'Starter', 'Initialiserer PR fix...');
            const { exec: prFixExec } = require('child_process');
            const prFixBat = path.join(CWD, '.planning', '_run_prfix.bat');
            let prFixArgs = `${prFixId} --headless`;
            if (prFixPrId) prFixArgs += ` --pr-id ${prFixPrId}`;
            if (prFixRepo) prFixArgs += ` --repo-name ${prFixRepo}`;
            fs.writeFileSync(prFixBat, `@echo off\nset "CLAUDECODE="\ncd /d "${CWD}"\nclaude -p "/devsprint-pr-fix ${prFixArgs}" --dangerously-skip-permissions --verbose\n`);
            prFixExec(`start /min cmd /c "${prFixBat}"`, { shell: true });
            data = { status: 'launched', storyId: prFixId };
          } else {
            res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
          }
          break;
        case '/api/plan':
          if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            await new Promise(r => req.on('end', r));
            const { storyId: planId } = JSON.parse(body);
            if (!planId) { res.writeHead(400); res.end(JSON.stringify({ error: 'storyId required' })); return; }
            if (isStoryRunning(planId)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Story #' + planId + ' has an active run' })); return; }
            seedAgentStatus(planId, 'Starter', 'Initialiserer analyse...');
            const qClean = path.join(CWD, '.planning', 'questions', planId + '.json');
            const aClean = path.join(CWD, '.planning', 'answers', planId + '.json');
            try { if (fs.existsSync(qClean)) fs.unlinkSync(qClean); } catch {}
            try { if (fs.existsSync(aClean)) fs.unlinkSync(aClean); } catch {}
            const execLogPath = path.join(CWD, '.planning', 'devsprint-execution-log.json');
            try {
              const el = JSON.parse(fs.readFileSync(execLogPath, 'utf8'));
              if (el && el.executions) {
                for (const e of el.executions) {
                  if (String(e.storyId) === String(planId)) e.reanalyzed = true;
                }
                fs.writeFileSync(execLogPath, JSON.stringify(el, null, 2));
              }
            } catch {}
            const { exec: planExec } = require('child_process');
            const planBat = path.join(CWD, '.planning', '_run_plan.bat');
            fs.writeFileSync(planBat, `@echo off\nset "CLAUDECODE="\ncd /d "${CWD}"\nclaude -p "/devsprint-plan ${planId} --headless --reanalyze" --dangerously-skip-permissions --verbose\n`);
            planExec(`start /min cmd /c "${planBat}"`, { shell: true });
            data = { status: 'launched', storyId: planId };
          } else {
            res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
          }
          break;
        case '/api/close-story':
          if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            await new Promise(r => req.on('end', r));
            const { storyId: closeId } = JSON.parse(body);
            if (!closeId) { res.writeHead(400); res.end(JSON.stringify({ error: 'storyId required' })); return; }
            try {
              data = await closeStory(closeId);
            } catch (e) {
              res.writeHead(500); res.end(JSON.stringify({ error: e.message })); return;
            }
          } else {
            res.writeHead(405); res.end(JSON.stringify({ error: 'POST only' })); return;
          }
          break;
        case '/api/summary':
          const [sprint, gitActivity, prStatus] = await Promise.all([
            fetchSprintData().catch(() => null),
            Promise.resolve(getGitActivity()),
            fetchPRStatus().catch(() => []),
          ]);
          const taskMap = getTaskMap();
          const execLog = getExecutionLog();
          data = { sprint, gitActivity, prStatus, taskMap, execLog };
          break;
        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Internal server error');
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  const cfg = getConfig();
  const provider = cfg.provider || 'azdo';
  console.log(`\n  DevSprint Dashboard running at http://localhost:${PORT}\n`);
  console.log(`  Provider: ${provider}`);
  if (provider === 'github') {
    console.log(`  Repo: ${cfg.githubOwner}/${cfg.githubRepo}`);
    console.log(`  MCP: GitHub Copilot MCP (https://api.githubcopilot.com/mcp/)`);
  } else {
    console.log(`  Org: ${cfg.org}  Project: ${cfg.project}`);
    console.log(`  MCP: @azure-devops/mcp (stdio)`);
  }
  console.log(`  Config: ${path.join(CWD, '.planning', 'devsprint-config.json')}`);
  console.log(`  Press Ctrl+C to stop\n`);
});

// Graceful shutdown: kill MCP child process
process.on('SIGINT', () => {
  if (azdoMcpProcess) {
    console.log('\n[mcp/azdo] Shutting down MCP process...');
    azdoMcpProcess.kill();
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (azdoMcpProcess) azdoMcpProcess.kill();
  process.exit(0);
});
