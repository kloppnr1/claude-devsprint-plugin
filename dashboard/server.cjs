#!/usr/bin/env node

/**
 * DevSprint Dashboard — Local web server for sprint visibility
 *
 * Usage: node dashboard/server.cjs [--port 3000] [--cwd <path>]
 *
 * Serves a web dashboard showing:
 *   - Live sprint board from Azure DevOps
 *   - Execution history and PR status
 *   - Git activity across target repos
 *   - Daily activity summary
 *
 * Uses ONLY Node.js built-ins (http, https, fs, path, child_process).
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const PORT = parseInt(getArg('--port', '3000'), 10);
const CWD = getArg('--cwd', process.cwd());

// ─── Config & HTTP Helpers (mirrored from devsprint-tools.cjs) ────────────────

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.planning', 'devsprint-config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`No config found at ${configPath}. Run /devsprint-setup first.`);
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const decoded = Buffer.from(cfg.pat, 'base64').toString('utf-8');
  const rawPat = decoded.startsWith(':') ? decoded.slice(1) : decoded;
  return { org: cfg.org, project: cfg.project, pat: rawPat, team: cfg.team || null, area: cfg.area || null };
}

function makeRequest(url, encodedPat, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Authorization': `Basic ${encodedPat}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

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

let cachedConfig = null;
function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig(CWD);
  return cachedConfig;
}

function getEncodedPat() {
  const cfg = getConfig();
  return Buffer.from(':' + cfg.pat).toString('base64');
}

async function fetchSprintData() {
  const cfg = getConfig();
  const encodedPat = getEncodedPat();
  const teamName = cfg.team || decodeURIComponent(cfg.project);

  // Get current sprint
  const iterUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
  const iterRes = await makeRequest(iterUrl, encodedPat);
  if (iterRes.status !== 200) throw new Error(`Sprint fetch failed: HTTP ${iterRes.status}`);
  const iterData = JSON.parse(iterRes.body);
  if (!iterData.value || iterData.value.length === 0) throw new Error('No active sprint');
  const iteration = iterData.value[0];

  // Get work item IDs
  const wiUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?api-version=7.1`;
  const wiRes = await makeRequest(wiUrl, encodedPat);
  if (wiRes.status !== 200) throw new Error(`Work items fetch failed: HTTP ${wiRes.status}`);
  const wiData = JSON.parse(wiRes.body);

  const idSet = new Set();
  for (const rel of (wiData.workItemRelations || [])) {
    if (rel.target) idSet.add(rel.target.id);
    if (rel.source) idSet.add(rel.source.id);
  }
  const ids = Array.from(idSet);
  if (ids.length === 0) return { sprint: iteration, items: [] };

  // Batch fetch details
  const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
  const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', {
    ids: ids.slice(0, 200),
    fields: [
      'System.Id', 'System.Title', 'System.WorkItemType', 'System.State',
      'System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria',
      'System.Parent', 'System.AssignedTo', 'System.Tags',
      'System.ChangedDate', 'System.CreatedDate',
    ],
    errorPolicy: 'omit',
  });
  if (batchRes.status !== 200) throw new Error(`Batch fetch failed: HTTP ${batchRes.status}`);
  const batchData = JSON.parse(batchRes.body);

  const allItems = (batchData.value || []).map((item) => {
    const assignedTo = item.fields['System.AssignedTo'];
    return {
      id: item.id,
      type: item.fields['System.WorkItemType'],
      title: item.fields['System.Title'],
      state: item.fields['System.State'],
      description: stripHtml(item.fields['System.Description'] || ''),
      parentId: item.fields['System.Parent'] || null,
      assignedTo: assignedTo ? assignedTo.displayName : null,
      tags: item.fields['System.Tags'] ? item.fields['System.Tags'].split('; ') : [],
      changedDate: item.fields['System.ChangedDate'] || null,
      createdDate: item.fields['System.CreatedDate'] || null,
    };
  });

  // Filter to current user's items (same logic as --me in devsprint-tools.cjs)
  let items = allItems;
  try {
    const connRes = await makeRequest(`${cfg.org}/_apis/connectiondata`, encodedPat);
    if (connRes.status === 200) {
      const connData = JSON.parse(connRes.body);
      const currentUser = connData.authenticatedUser?.providerDisplayName;
      if (currentUser) {
        const myIds = new Set(allItems.filter(i => i.assignedTo === currentUser).map(i => i.id));
        const myParentIds = new Set(allItems.filter(i => myIds.has(i.id) && i.parentId).map(i => i.parentId));
        const myChildIds = new Set(allItems.filter(i => myIds.has(i.parentId)).map(i => i.id));
        const allMyIds = new Set([...myIds, ...myParentIds, ...myChildIds]);
        items = allItems.filter(i => allMyIds.has(i.id));
      }
    }
  } catch {}

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

async function fetchPRStatus() {
  const execLog = getExecutionLog();
  if (!execLog || !execLog.executions) return [];

  const cfg = getConfig();
  const encodedPat = getEncodedPat();
  const results = [];

  for (const exec of execLog.executions) {
    if (!exec.prId || !exec.prUrl) continue;
    // Extract repo name from PR URL
    const match = exec.prUrl.match(/_git\/([^/]+)\/pullRequest/);
    if (!match) continue;
    const repoName = match[1];

    try {
      const prUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${repoName}/pullrequests/${exec.prId}?api-version=7.1`;
      const res = await makeRequest(prUrl, encodedPat);
      if (res.status === 200) {
        const pr = JSON.parse(res.body);
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
            vote: r.vote, // -10=rejected, -5=waiting, 0=none, 5=approved_with_suggestions, 10=approved
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
            const { storyId } = JSON.parse(body);
            if (!storyId) { res.writeHead(400); res.end(JSON.stringify({ error: 'storyId required' })); return; }
            const { exec: execFn } = require('child_process');
            const cleanEnv = Object.assign({}, process.env);
            delete cleanEnv.CLAUDECODE;
            const execBat = path.join(CWD, '.planning', '_run_exec.bat');
            fs.writeFileSync(execBat, `@echo off\nset "CLAUDECODE="\ncd /d "${CWD}"\nclaude -p "/devsprint-execute ${storyId} --headless" --dangerously-skip-permissions --verbose\n`);
            execFn(`start cmd /k "${execBat}"`, { shell: true });
            data = { status: 'launched', storyId };
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
            // Clean up stale question/answer files
            const qClean = path.join(CWD, '.planning', 'questions', planId + '.json');
            const aClean = path.join(CWD, '.planning', 'answers', planId + '.json');
            try { if (fs.existsSync(qClean)) fs.unlinkSync(qClean); } catch {}
            try { if (fs.existsSync(aClean)) fs.unlinkSync(aClean); } catch {}
            const { exec: planExec } = require('child_process');
            const planEnv = Object.assign({}, process.env);
            delete planEnv.CLAUDECODE;
            const planBat = path.join(CWD, '.planning', '_run_plan.bat');
            fs.writeFileSync(planBat, `@echo off\nset "CLAUDECODE="\ncd /d "${CWD}"\nclaude -p "/devsprint-plan ${planId} --headless --reanalyze" --dangerously-skip-permissions --verbose\n`);
            planExec(`start cmd /k "${planBat}"`, { shell: true });
            data = { status: 'launched', storyId: planId };
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
  console.log(`\n  DevSprint Dashboard running at http://localhost:${PORT}\n`);
  console.log(`  Config: ${path.join(CWD, '.planning', 'devsprint-config.json')}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
