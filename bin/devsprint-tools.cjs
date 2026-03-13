#!/usr/bin/env node

/**
 * devsprint-tools.cjs — Local operations helper for Claude Code skills
 *
 * This is the REDUCED version after MCP migration. All Azure DevOps API calls
 * now go through the official MCP server (@azure-devops/mcp). This file only
 * handles local operations that can't use MCP:
 *
 * - create-branch: Local git operations (stash, fetch, checkout)
 * - parse-file: Binary file parsing (.msg, .eml, .docx)
 * - report-status: Dashboard agent status file I/O
 * - clear-status: Dashboard agent status cleanup
 * - save-config / load-config / test: Dashboard PAT config management
 *
 * Uses ONLY Node.js built-ins (fs, path, https, child_process, zlib).
 * No external dependencies.
 *
 * Usage: node devsprint-tools.cjs <command> [options] [--cwd <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ─── Config Helpers (for dashboard PAT management) ──────────────────────────

function getConfigPath(cwd) {
  return path.join(cwd, '.planning', 'devsprint-config.json');
}

function normaliseOrg(input) {
  if (!input) return input;
  let s = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(s)) return s;
  return `https://dev.azure.com/${s}`;
}

function loadConfig(cwd) {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No Azure DevOps config found at ${configPath}. Run /devsprint-setup to configure.`
    );
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const cfg = JSON.parse(raw);

  if (!cfg.org || !cfg.project || !cfg.pat) {
    throw new Error(
      `Invalid config at ${configPath}: missing org, project, or pat. Run /devsprint-setup to reconfigure.`
    );
  }

  const decoded = Buffer.from(cfg.pat, 'base64').toString('utf-8');
  const rawPat = decoded.startsWith(':') ? decoded.slice(1) : decoded;
  return { org: cfg.org, project: cfg.project, pat: rawPat, team: cfg.team || null, area: cfg.area || null };
}

function saveConfig(cwd, { org, project, pat, team, area }) {
  const normalised = normaliseOrg(org);
  const encoded = Buffer.from(':' + pat).toString('base64');

  const configPath = getConfigPath(cwd);
  const planningDir = path.dirname(configPath);
  if (!fs.existsSync(planningDir)) {
    fs.mkdirSync(planningDir, { recursive: true });
  }

  const config = {
    org: normalised,
    project,
    pat: encoded,
    ...(team && { team }),
    ...(area && { area }),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return { org: normalised, project, team: team || null, area: area || null };
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

// ─── Config Commands ────────────────────────────────────────────────────────

async function cmdSaveConfig(cwd, args) {
  const get = (name) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

  const org = get('--org');
  const project = get('--project');
  const pat = get('--pat');
  const team = get('--team');
  const area = get('--area');

  const missing = [];
  if (!org) missing.push('--org');
  if (!project) missing.push('--project');
  if (!pat) missing.push('--pat');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    const result = saveConfig(cwd, { org, project, pat, team, area });
    console.log(JSON.stringify({ status: 'saved', ...result }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

async function cmdLoadConfig(cwd) {
  try {
    const cfg = loadConfig(cwd);
    console.log(JSON.stringify({ org: cfg.org, project: cfg.project, pat: cfg.pat, team: cfg.team, area: cfg.area }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

async function cmdTest(cwd) {
  let cfg;
  try {
    cfg = loadConfig(cwd);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const { org, project, pat } = cfg;
  const encodedPat = Buffer.from(':' + pat).toString('base64');

  // Verify auth + project access
  let projectsRes;
  try {
    projectsRes = await makeRequest(`${org}/_apis/projects?$top=1&api-version=7.1`, encodedPat);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (projectsRes.status === 401) {
    console.error('Authentication failed. Check your PAT is correct and has not expired.');
    process.exit(1);
  }
  if (projectsRes.status === 403) {
    console.error('Authorisation denied. Check your PAT has the vso.project scope.');
    process.exit(1);
  }
  if (projectsRes.status !== 200) {
    console.error(`Unexpected response: HTTP ${projectsRes.status}`);
    process.exit(1);
  }

  // Verify work item access
  let wiRes;
  try {
    wiRes = await makeRequest(
      `${org}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`,
      encodedPat,
      'POST',
      { query: "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 1" }
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (wiRes.status === 401 || wiRes.status === 403) {
    console.error(`Project access works but work items failed (HTTP ${wiRes.status}). Check your PAT has vso.work scope.`);
    process.exit(1);
  }

  console.log(`Connected to ${org}/${project}`);
  process.exit(0);
}

// ─── Report Status / Clear Status (dashboard file I/O) ─────────────────────

function cmdReportStatus(cwd, args) {
  const get = (name) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

  const statusPath = path.join(cwd, '.planning', 'devsprint-agent-status.json');
  const planningDir = path.dirname(statusPath);
  if (!fs.existsSync(planningDir)) fs.mkdirSync(planningDir, { recursive: true });

  let existing = { active: null, history: [] };
  try {
    if (fs.existsSync(statusPath)) existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {}

  const storyId = get('--story-id');
  const now = new Date().toISOString();
  const newStep = get('--step') || 'unknown';

  const status = {
    storyId: storyId ? parseInt(storyId, 10) : (existing.active ? existing.active.storyId : null),
    storyTitle: get('--story-title') || (existing.active ? existing.active.storyTitle : null),
    step: newStep,
    detail: get('--detail') || null,
    repo: get('--repo') || (existing.active ? existing.active.repo : null),
    branch: get('--branch') || (existing.active ? existing.active.branch : null),
    command: get('--command') || (existing.active ? existing.active.command : null),
    startedAt: existing.active ? existing.active.startedAt : now,
    updatedAt: now,
    stories: existing.active && existing.active.stories ? { ...existing.active.stories } : {},
    stepLog: existing.active && existing.active.stepLog ? [...existing.active.stepLog] : [],
  };

  const lastLog = status.stepLog.length ? status.stepLog[status.stepLog.length - 1] : null;
  if (!lastLog || lastLog.step !== newStep) {
    status.stepLog.push({ step: newStep, detail: get('--detail') || null, at: now, storyId: storyId ? parseInt(storyId, 10) : null });
  }

  if (storyId) {
    const sid = String(storyId);
    const prev = status.stories[sid];
    const storyStepLog = prev && prev.stepLog ? [...prev.stepLog] : [];
    const lastStoryLog = storyStepLog.length ? storyStepLog[storyStepLog.length - 1] : null;
    if (!lastStoryLog || lastStoryLog.step !== newStep) {
      storyStepLog.push({ step: newStep, detail: get('--detail') || null, at: now, storyId: parseInt(storyId, 10) });
    }
    status.stories[sid] = {
      storyId: parseInt(storyId, 10),
      storyTitle: get('--story-title') || (prev ? prev.storyTitle : null),
      step: get('--step') || 'unknown',
      detail: get('--detail') || null,
      command: get('--command') || (prev ? prev.command : null),
      startedAt: prev ? prev.startedAt : now,
      updatedAt: now,
      stepLog: storyStepLog,
    };
  }

  const output = { active: status, history: existing.history || [] };
  fs.writeFileSync(statusPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(JSON.stringify({ status: 'reported', step: status.step }));
  process.exit(0);
}

function cmdClearStatus(cwd, args) {
  const get = (name) => { const i = (args || []).indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null; };
  const statusPath = path.join(cwd, '.planning', 'devsprint-agent-status.json');
  let existing = { active: null, history: [] };
  try {
    if (fs.existsSync(statusPath)) existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {}

  const targetStoryId = get('--story-id');
  const now = new Date().toISOString();

  if (targetStoryId && existing.active && existing.active.stories) {
    const sid = String(targetStoryId);
    const storyData = existing.active.stories[sid];
    if (storyData) {
      const archived = { ...storyData, endedAt: now, step: 'Done' };
      if (archived.stepLog) {
        const lastLog = archived.stepLog.length ? archived.stepLog[archived.stepLog.length - 1] : null;
        if (!lastLog || lastLog.step !== 'Done') {
          archived.stepLog.push({ step: 'Done', detail: null, at: now, storyId: parseInt(targetStoryId, 10) });
        }
      }
      if (!existing.history) existing.history = [];
      existing.history.unshift(archived);
      if (existing.history.length > 50) existing.history = existing.history.slice(0, 50);
      delete existing.active.stories[sid];
    }
    if (Object.keys(existing.active.stories).length === 0) {
      existing.active = null;
    }
  } else if (existing.active) {
    const stories = existing.active.stories || {};
    for (const sid of Object.keys(stories)) {
      const storyData = stories[sid];
      const archived = { ...storyData, endedAt: now, step: 'Done' };
      if (archived.stepLog) {
        const lastLog = archived.stepLog.length ? archived.stepLog[archived.stepLog.length - 1] : null;
        if (!lastLog || lastLog.step !== 'Done') {
          archived.stepLog.push({ step: 'Done', detail: null, at: now, storyId: storyData.storyId || null });
        }
      }
      if (!existing.history) existing.history = [];
      existing.history.unshift(archived);
    }
    if (Object.keys(stories).length === 0) {
      const archived = { ...existing.active, endedAt: now, step: 'Done' };
      if (archived.stepLog) {
        const lastLog = archived.stepLog.length ? archived.stepLog[archived.stepLog.length - 1] : null;
        if (!lastLog || lastLog.step !== 'Done') {
          archived.stepLog.push({ step: 'Done', detail: null, at: now, storyId: archived.storyId || null });
        }
      }
      existing.history.unshift(archived);
    }
    if (existing.history.length > 50) existing.history = existing.history.slice(0, 50);
    existing.active = null;
  }
  fs.writeFileSync(statusPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(JSON.stringify({ status: 'cleared' }));
  process.exit(0);
}

// ─── File Parsing (.msg, .eml, .docx) ──────────────────────────────────────

async function cmdParseFile(cwd, args) {
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;

  if (!filePath) {
    console.error('Usage: devsprint-tools.cjs parse-file --file <path> [--cwd <path>]');
    process.exit(1);
  }

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const buf = fs.readFileSync(filePath);

    if (ext === '.msg') {
      const result = parseMsgFile(buf);
      console.log(JSON.stringify({ status: 'ok', type: 'msg', ...result }));
    } else if (ext === '.eml') {
      const result = parseEmlFile(buf.toString('utf-8'));
      console.log(JSON.stringify({ status: 'ok', type: 'eml', ...result }));
    } else if (ext === '.docx') {
      const result = parseDocxFile(buf);
      console.log(JSON.stringify({ status: 'ok', type: 'docx', ...result }));
    } else {
      const text = buf.toString('utf-8');
      console.log(JSON.stringify({ status: 'ok', type: 'text', body: text }));
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function parseMsgFile(buf) {
  const result = { subject: '', from: '', to: '', date: '', body: '' };

  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) {
    result.body = extractReadableStrings(buf);
    return result;
  }

  try {
    const sectorSize = 1 << buf.readUInt16LE(30);
    const miniSectorSize = 1 << buf.readUInt16LE(32);
    const fatSectors = buf.readUInt32LE(44);
    const firstDirSector = buf.readUInt32LE(48);
    const miniStreamCutoff = buf.readUInt32LE(56);
    const firstMiniFatSector = buf.readInt32LE(60);

    const fat = [];
    const difatEntries = [];
    for (let i = 0; i < 109 && i < fatSectors; i++) {
      difatEntries.push(buf.readUInt32LE(76 + i * 4));
    }
    for (const fatSectorIdx of difatEntries) {
      if (fatSectorIdx >= 0xFFFFFFFE) break;
      const fatOffset = (fatSectorIdx + 1) * sectorSize;
      for (let j = 0; j < sectorSize / 4; j++) {
        fat.push(buf.readUInt32LE(fatOffset + j * 4));
      }
    }

    function readSectorChain(startSector) {
      const chunks = [];
      let sector = startSector;
      let safety = 0;
      while (sector >= 0 && sector < 0xFFFFFFFE && safety < 10000) {
        const offset = (sector + 1) * sectorSize;
        if (offset + sectorSize > buf.length) break;
        chunks.push(buf.slice(offset, offset + sectorSize));
        sector = fat[sector] !== undefined ? fat[sector] : 0xFFFFFFFE;
        safety++;
      }
      return Buffer.concat(chunks);
    }

    const dirData = readSectorChain(firstDirSector);
    const entries = [];
    for (let i = 0; i + 128 <= dirData.length; i += 128) {
      const nameLen = dirData.readUInt16LE(i + 64);
      if (nameLen <= 0) continue;
      const nameBytes = dirData.slice(i, i + nameLen - 2);
      const name = nameBytes.toString('utf16le');
      const type = dirData.readUInt8(i + 66);
      const startSector = dirData.readUInt32LE(i + 116);
      const size = dirData.readUInt32LE(i + 120);
      entries.push({ name, type, startSector, size });
    }

    const rootEntry = entries[0];
    let miniStream = Buffer.alloc(0);
    if (rootEntry && rootEntry.startSector < 0xFFFFFFFE) {
      miniStream = readSectorChain(rootEntry.startSector);
    }

    const miniFat = [];
    if (firstMiniFatSector >= 0 && firstMiniFatSector < 0xFFFFFFFE) {
      const miniFatData = readSectorChain(firstMiniFatSector);
      for (let i = 0; i + 4 <= miniFatData.length; i += 4) {
        miniFat.push(miniFatData.readUInt32LE(i));
      }
    }

    function readMiniChain(startSector, size) {
      const chunks = [];
      let sector = startSector;
      let remaining = size;
      let safety = 0;
      while (sector >= 0 && sector < 0xFFFFFFFE && remaining > 0 && safety < 10000) {
        const offset = sector * miniSectorSize;
        const chunkSize = Math.min(miniSectorSize, remaining);
        if (offset + chunkSize > miniStream.length) break;
        chunks.push(miniStream.slice(offset, offset + chunkSize));
        remaining -= chunkSize;
        sector = miniFat[sector] !== undefined ? miniFat[sector] : 0xFFFFFFFE;
        safety++;
      }
      return Buffer.concat(chunks);
    }

    function readEntryData(entry) {
      if (entry.size === 0) return Buffer.alloc(0);
      if (entry.size < miniStreamCutoff) {
        return readMiniChain(entry.startSector, entry.size);
      } else {
        return readSectorChain(entry.startSector).slice(0, entry.size);
      }
    }

    const propMap = {
      '__substg1.0_0037001F': 'subject',
      '__substg1.0_0037001E': 'subject',
      '__substg1.0_0C1A001F': 'from',
      '__substg1.0_0C1A001E': 'from',
      '__substg1.0_0E04001F': 'to',
      '__substg1.0_0E04001E': 'to',
      '__substg1.0_1000001F': 'body',
      '__substg1.0_1000001E': 'body',
      '__substg1.0_1009001E': 'rtfBody',
    };

    for (const entry of entries) {
      const lname = entry.name.toLowerCase().replace(/[^\x20-\x7e]/g, '');
      for (const [pattern, field] of Object.entries(propMap)) {
        if (lname === pattern || lname.includes(pattern.slice(12))) {
          if (field === 'rtfBody') continue;
          try {
            const data = readEntryData(entry);
            const isUnicode = entry.name.includes('001F');
            const text = isUnicode ? data.toString('utf16le') : data.toString('utf-8');
            const cleaned = text.replace(/\0/g, '').trim();
            if (cleaned && (!result[field] || cleaned.length > result[field].length)) {
              result[field] = cleaned;
            }
          } catch (e) { /* skip unreadable entries */ }
        }
      }
    }

    if (!result.body) {
      result.body = extractReadableStrings(buf);
    }
  } catch (e) {
    result.body = extractReadableStrings(buf);
  }

  return result;
}

function extractReadableStrings(buf) {
  const strings = [];
  let current = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code >= 0x20 && code < 0x7F || code >= 0xC0 && code < 0x2000) {
      current += String.fromCharCode(code);
    } else {
      if (current.length >= 10) strings.push(current);
      current = '';
    }
  }
  if (current.length >= 10) strings.push(current);

  let asciiCurrent = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7F) {
      asciiCurrent += String.fromCharCode(b);
    } else if (b === 0x0A || b === 0x0D) {
      asciiCurrent += '\n';
    } else {
      if (asciiCurrent.length >= 10) strings.push(asciiCurrent.trim());
      asciiCurrent = '';
    }
  }
  if (asciiCurrent.length >= 10) strings.push(asciiCurrent.trim());

  const unique = [...new Set(strings)].filter(s => s.trim().length > 10);
  unique.sort((a, b) => b.length - a.length);
  return unique.slice(0, 20).join('\n\n');
}

function parseEmlFile(text) {
  const result = { subject: '', from: '', to: '', date: '', body: '' };
  const headerEnd = text.indexOf('\r\n\r\n');
  const splitIdx = headerEnd !== -1 ? headerEnd : text.indexOf('\n\n');
  const headers = splitIdx !== -1 ? text.substring(0, splitIdx) : '';
  const body = splitIdx !== -1 ? text.substring(splitIdx).trim() : text;

  const subjectMatch = headers.match(/^Subject:\s*(.+)$/mi);
  const fromMatch = headers.match(/^From:\s*(.+)$/mi);
  const toMatch = headers.match(/^To:\s*(.+)$/mi);
  const dateMatch = headers.match(/^Date:\s*(.+)$/mi);

  if (subjectMatch) result.subject = subjectMatch[1].trim();
  if (fromMatch) result.from = fromMatch[1].trim();
  if (toMatch) result.to = toMatch[1].trim();
  if (dateMatch) result.date = dateMatch[1].trim();
  result.body = body;
  return result;
}

function parseDocxFile(buf) {
  const result = { body: '' };
  const zlib = require('zlib');

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054B50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) { result.body = '(Could not parse .docx — invalid ZIP)'; return result; }

  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  const centralDirEntries = buf.readUInt16LE(eocdOffset + 10);

  let offset = centralDirOffset;
  for (let i = 0; i < centralDirEntries && offset + 46 < buf.length; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014B50) break;
    const compMethod = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf-8', offset + 46, offset + 46 + nameLen);

    if (name === 'word/document.xml') {
      const lhOffset = localHeaderOffset;
      if (buf.readUInt32LE(lhOffset) === 0x04034B50) {
        const lhNameLen = buf.readUInt16LE(lhOffset + 26);
        const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
        const dataOffset = lhOffset + 30 + lhNameLen + lhExtraLen;
        const compData = buf.slice(dataOffset, dataOffset + compSize);

        let xmlText;
        if (compMethod === 0) {
          xmlText = compData.toString('utf-8');
        } else {
          try {
            xmlText = require('zlib').inflateRawSync(compData).toString('utf-8');
          } catch (e) {
            result.body = '(Could not decompress .docx content)';
            return result;
          }
        }
        result.body = xmlText.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
      }
      break;
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  if (!result.body) result.body = '(No document.xml found in .docx)';
  return result;
}

// ─── Git Helpers ────────────────────────────────────────────────────────────

function run(cmd, cwd) {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').trim() };
  }
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function cmdCreateBranch(cwd, args) {
  const repoIdx = args.indexOf('--repo');
  const storyIdx = args.indexOf('--story-id');
  const titleIdx = args.indexOf('--title');
  const baseIdx = args.indexOf('--base');

  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;
  const storyId = storyIdx !== -1 ? args[storyIdx + 1] : null;
  const title = titleIdx !== -1 ? args[titleIdx + 1] : null;
  const preferredBase = baseIdx !== -1 ? args[baseIdx + 1] : 'develop';

  const missing = [];
  if (!repo) missing.push('--repo');
  if (!storyId) missing.push('--story-id');
  if (!title) missing.push('--title');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]');
    process.exit(1);
  }

  const repoPath = path.resolve(repo);
  if (!fs.existsSync(repoPath)) {
    console.error(`Repository path does not exist: ${repoPath}`);
    process.exit(1);
  }

  try {
    const branchName = `feature/${storyId}-${slugify(title)}`;

    // Step 1: Stash if dirty
    const status = run('git status --porcelain', repoPath);
    if (status.ok && status.stdout.length > 0) {
      const stash = run('git stash --include-untracked', repoPath);
      if (!stash.ok) {
        console.error(`Failed to stash changes: ${stash.error}`);
        process.exit(1);
      }
    }

    // Step 2: Determine base branch
    let baseBranch = preferredBase;
    const fetchBase = run(`git fetch origin ${baseBranch}`, repoPath);
    if (!fetchBase.ok) {
      baseBranch = preferredBase === 'main' ? 'develop' : 'main';
      const fetchFallback = run(`git fetch origin ${baseBranch}`, repoPath);
      if (!fetchFallback.ok) {
        console.error(`Could not fetch base branch. Tried '${preferredBase}' and '${baseBranch}'. Error: ${fetchFallback.error}`);
        process.exit(1);
      }
    }

    // Step 3: Check if branch already exists
    const branchExists = run(`git rev-parse --verify ${branchName}`, repoPath);
    if (branchExists.ok) {
      const remoteCheck = run(`git ls-remote --heads origin ${branchName}`, repoPath);
      const remoteExists = remoteCheck.ok && remoteCheck.stdout.trim().length > 0;

      if (!remoteExists) {
        // Remote branch gone (merged & deleted) — create fresh with -v2 suffix
        let newName = branchName + '-v2';
        let suffix = 2;
        while (run(`git rev-parse --verify ${newName}`, repoPath).ok) {
          suffix++;
          newName = branchName + '-v' + suffix;
        }
        const create = run(`git checkout -b ${newName} origin/${baseBranch}`, repoPath);
        if (!create.ok) {
          console.error(`Failed to create branch ${newName}: ${create.error}`);
          process.exit(1);
        }
        console.log(JSON.stringify({ branch: newName, base: baseBranch, created: true }));
        process.exit(0);
      }

      // Exists locally and remotely — just checkout
      const checkout = run(`git checkout ${branchName}`, repoPath);
      if (!checkout.ok) {
        console.error(`Failed to checkout existing branch ${branchName}: ${checkout.error}`);
        process.exit(1);
      }
      console.log(JSON.stringify({ branch: branchName, base: baseBranch, created: false }));
      process.exit(0);
    }

    // Step 4: Create new branch
    const create = run(`git checkout -b ${branchName} origin/${baseBranch}`, repoPath);
    if (!create.ok) {
      console.error(`Failed to create branch ${branchName}: ${create.error}`);
      process.exit(1);
    }

    console.log(JSON.stringify({ branch: branchName, base: baseBranch, created: true }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Extract --cwd flag
  let cwd = process.cwd();
  const cwdEqArg = args.find(arg => arg.startsWith('--cwd='));
  const cwdIdx = args.indexOf('--cwd');

  if (cwdEqArg) {
    const value = cwdEqArg.slice('--cwd='.length).trim();
    if (!value) { console.error('Missing value for --cwd'); process.exit(1); }
    args.splice(args.indexOf(cwdEqArg), 1);
    cwd = path.resolve(value);
  } else if (cwdIdx !== -1) {
    const value = args[cwdIdx + 1];
    if (!value || value.startsWith('--')) { console.error('Missing value for --cwd'); process.exit(1); }
    args.splice(cwdIdx, 2);
    cwd = path.resolve(value);
  }

  const command = args[0];

  if (!command) {
    console.error('Usage: devsprint-tools.cjs <command> [options] [--cwd <path>]');
    console.error('');
    console.error('Local commands (Azure DevOps API calls now use MCP):');
    console.error('  create-branch  --repo <path> --story-id <id> --title <title> [--base <branch>]');
    console.error('  parse-file     --file <path>');
    console.error('  report-status  --step <step> --detail <detail> [--story-id <id>] [--story-title <title>]');
    console.error('  clear-status   [--story-id <id>]');
    console.error('');
    console.error('Dashboard config (PAT-based, for standalone dashboard server):');
    console.error('  save-config    --org <org> --project <project> --pat <pat> [--team <team>] [--area <area>]');
    console.error('  load-config    Read credentials from .planning/devsprint-config.json');
    console.error('  test           Test dashboard PAT connection to Azure DevOps');
    process.exit(1);
  }

  const cmdArgs = args.slice(1);

  switch (command) {
    case 'create-branch':
      await cmdCreateBranch(cwd, cmdArgs);
      break;
    case 'parse-file':
      await cmdParseFile(cwd, cmdArgs);
      break;
    case 'report-status':
      cmdReportStatus(cwd, cmdArgs);
      break;
    case 'clear-status':
      cmdClearStatus(cwd, cmdArgs);
      break;
    case 'save-config':
      await cmdSaveConfig(cwd, cmdArgs);
      break;
    case 'load-config':
      await cmdLoadConfig(cwd);
      break;
    case 'test':
      await cmdTest(cwd);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: create-branch, parse-file, report-status, clear-status, save-config, load-config, test');
      console.error('Note: Azure DevOps API commands have been removed. Use the MCP server instead.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
