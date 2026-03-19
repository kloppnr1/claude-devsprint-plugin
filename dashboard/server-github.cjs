#!/usr/bin/env node

/**
 * DevSprint Dashboard — GitHub-backed server
 *
 * Usage: node dashboard/server-github.cjs [--port 3000] [--cwd <path>]
 *
 * Serves the same dashboard UI but fetches data from GitHub Issues
 * instead of Azure DevOps. Reads config from .planning/github-config.json:
 *   { "owner": "...", "repo": "...", "token": "ghp_..." }
 *
 * GitHub issues → sprint items mapping:
 *   - Issues without a milestone label → "Aktiv sprint" bucket
 *   - open  → state "Active"
 *   - closed → state "Closed"
 *   - Regular issues → type "User Story"
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const PORT = parseInt(getArg('--port', '3000'), 10);
const CWD = getArg('--cwd', process.cwd());

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = path.join(CWD, '.planning', 'github-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No GitHub config found at ${configPath}. Create it with: { "owner": "...", "repo": "...", "token": "ghp_..." }`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

let cachedConfig = null;
function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

// ─── GitHub API Helper ────────────────────────────────────────────────────────

function ghRequest(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'devsprint-dashboard/2.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

// ─── Sprint context reader ────────────────────────────────────────────────────

function readSprintContext() {
  const sprintPaths = [
    path.join(CWD, 'sprint-context.md'),
    path.join(CWD, '..', 'sprint-context.md'),
  ];
  for (const p of sprintPaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return null;
}

function parseSprintName(context) {
  if (!context) return null;
  const match = context.match(/##\s+Active Sprint[\s\S]*?\*\*Sprint goal[:\*]+\*?\s*(.+)/i) ||
                context.match(/sprint goal[:\*]+\s*(.+)/i);
  return match ? match[1].trim() : null;
}

// ─── Data Fetcher ─────────────────────────────────────────────────────────────

async function fetchSprintData() {
  const cfg = getConfig();

  // Fetch all open issues (not PRs)
  const res = await ghRequest(
    `/repos/${cfg.owner}/${cfg.repo}/issues?state=all&per_page=100&sort=updated&direction=desc`,
    cfg.token
  );

  if (res.status !== 200) {
    throw new Error(`GitHub API returned ${res.status}: ${res.body}`);
  }

  const ghIssues = JSON.parse(res.body);

  // Filter out PRs (GitHub returns PRs in /issues endpoint too)
  const issues = ghIssues.filter(i => !i.pull_request);

  // Map to sprint item format
  const items = issues.map(issue => ({
    id: issue.number,
    type: 'User Story',
    title: issue.title,
    state: issue.state === 'open' ? 'Active' : 'Closed',
    description: issue.body || '',
    parentId: null,
    assignedTo: issue.assignee ? issue.assignee.login : null,
    tags: issue.labels ? issue.labels.map(l => l.name) : [],
    changedDate: issue.updated_at,
    createdDate: issue.created_at,
    url: issue.html_url,
  }));

  // Build sprint info from sprint-context.md or repo info
  const sprintCtx = readSprintContext();
  const sprintName = parseSprintName(sprintCtx) || `${cfg.owner}/${cfg.repo}`;

  const sprint = {
    name: sprintName,
    path: `${cfg.owner}/${cfg.repo}`,
    startDate: null,
    finishDate: null,
    repoUrl: `https://github.com/${cfg.owner}/${cfg.repo}`,
  };

  return { sprint, items };
}

// ─── Stub helpers (keep API surface compatible with Azure version) ─────────────

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

function getAgentStatus() {
  return readJsonFile(path.join(CWD, '.planning', 'devsprint-agent-status.json'));
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

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    try {
      let data;
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
          data = [];
          break;
        case '/api/agent-status':
          data = getAgentStatus() || { active: null, history: [] };
          break;
        case '/api/pr-status':
          data = [];
          break;
        case '/api/summary': {
          const [sprint, prStatus] = await Promise.all([
            fetchSprintData().catch(() => null),
            Promise.resolve([]),
          ]);
          data = { sprint, gitActivity: [], prStatus, taskMap: getTaskMap(), execLog: getExecutionLog() };
          break;
        }
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

  // Static file serving — serve from same directory as server.cjs (the dashboard/ dir)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

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
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  } catch {
    res.writeHead(500);
    res.end('Internal server error');
  }
}

const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  const cfg = loadConfig();
  console.log(`\n  DevSprint Dashboard (GitHub mode) running at http://localhost:${PORT}`);
  console.log(`  Repo: https://github.com/${cfg.owner}/${cfg.repo}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
