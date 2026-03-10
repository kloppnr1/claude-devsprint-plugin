#!/usr/bin/env node

/**
 * devsprint-tools.cjs — Azure DevOps API helper for Claude Code skills
 *
 * Handles config file I/O, PAT encoding/decoding, HTTP requests to Azure DevOps REST API,
 * and connection testing. Uses ONLY Node.js built-ins (fs, path, https, Buffer).
 * No external dependencies.
 *
 * Usage: node azdo-tools.cjs <command> [options] [--cwd <path>]
 *
 * Commands:
 *   save-config --org <org> --project <project> --pat <pat> [--cwd <path>]
 *     Saves Azure DevOps credentials to .planning/devsprint-config.json
 *     Normalizes org URL to slug, base64-encodes PAT.
 *     stdout: JSON {"status":"saved","org":"...","project":"..."}
 *     Exit 0 on success, exit 1 on error.
 *
 *   load-config [--cwd <path>]
 *     Reads .planning/devsprint-config.json, decodes PAT.
 *     stdout: JSON {"org":"...","project":"...","pat":"<raw>"}
 *     Exit 0 on success, exit 1 if no config found.
 *
 *   test [--cwd <path>]
 *     Tests connection against Azure DevOps API.
 *     Success: stdout "Connected to {org}/{project}" + exit 0
 *     Failure: stderr error message + exit 1
 *
 *   get-sprint [--cwd <path>]
 *     Fetches the current active sprint iteration.
 *     stdout: JSON {"iterationId":"...","name":"...","path":"...","startDate":"...","finishDate":"..."}
 *     Exit 0 on success, exit 1 on error.
 *
 *   get-sprint-items [--me] [--cwd <path>]
 *     Fetches all work items in the current sprint with full details.
 *     stdout: JSON array [{"id":N,"type":"...","title":"...","state":"...","description":"...","acceptanceCriteria":"...","parentId":N|null}]
 *     --me: Filter to items assigned to the authenticated user (plus parent stories and child tasks)
 *     Exit 0 on success, exit 1 on error.
 *
 *   get-branch-links --id <workItemId> [--cwd <path>]
 *     Resolves branch artifact links from a work item into repository details.
 *     stdout: JSON array [{"repositoryId":"...","repositoryName":"...","remoteUrl":"...","branchName":"..."}]
 *     Returns [] if no branch link found (not an error).
 *     Required PAT scopes: vso.work + vso.code
 *     Exit 0 on success, exit 1 on API error.
 *
 *   update-description --id <workItemId> --description "<text>" [--cwd <path>]
 *     Updates the Description field of a work item using the PATCH API.
 *     Uses application/json-patch+json content type as required by Azure DevOps.
 *     stdout: JSON {"status":"updated","id":N}
 *     Exit 0 on success, exit 1 on error.
 *
 *   update-acceptance-criteria --id <workItemId> --criteria "<html>" [--cwd <path>]
 *     Updates the Acceptance Criteria field of a work item using the PATCH API.
 *     The criteria field accepts HTML for rich formatting.
 *     stdout: JSON {"status":"updated","id":N}
 *     Exit 0 on success, exit 1 on error.
 *
 *   update-state --id <workItemId> --state <state> [--cwd <path>]
 *     Changes the System.State field of a work item via the PATCH API.
 *     Uses op:add on /fields/System.State per Azure DevOps API convention.
 *     stdout: JSON {"status":"updated","id":N,"state":"<state>"}
 *     Exit 0 on success, exit 1 on error (invalid transition, 403, etc.).
 *
 *   get-child-states --id <storyId> [--cwd <path>]
 *     Fetches all child task states for a given parent story.
 *     Step 1: GET work item with $expand=relations to find Hierarchy-Forward children.
 *     Step 2: Batch GET child work items for id, title, and state fields.
 *     stdout: JSON {"allResolved":bool,"children":[{"id":N,"title":"...","state":"..."},...]}
 *     allResolved is true when all children are in Resolved, Closed, or Done state.
 *     Exit 0 always (caller decides what to do with the result).
 *
 *   create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
 *     Creates a feature branch from a base branch (default: develop, fallback: main).
 *     Stashes uncommitted changes if working tree is dirty.
 *     Branch name: feature/<storyId>-<slugified-title>
 *     stdout: JSON {"branch":"...","base":"...","created":true|false}
 *     Exit 0 on success, exit 1 on error.
 *
 *   create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd <path>
 *     Pushes the branch to origin and creates a pull request via Azure DevOps REST API.
 *     Links the PR to the story when --story-id is provided.
 *     stdout: JSON {"pr":"<url>","prId":N,"branch":"...","base":"...","pushed":true,"linked":true|false}
 *     Exit 0 on success, exit 1 on error.
 *
 *   get-pr --repo-name <name> --pr-id <id> --cwd <path>
 *     Fetches PR details (title, branches, status, linked work items).
 *     stdout: JSON {"prId":N,"title":"...","status":"...","sourceBranch":"...","targetBranch":"...","workItemIds":[...]}
 *     Exit 0 on success, exit 1 on error.
 *
 *   get-pr-threads --repo-name <name> --pr-id <id> [--active-only] --cwd <path>
 *     Fetches comment threads on a PR (review comments with file/line context).
 *     stdout: JSON array [{"threadId":N,"status":"active","comments":[...],"filePath":"...","lineNumber":N}]
 *     Exit 0 on success, exit 1 on error.
 *
 *   show-sprint [--me] [--cwd <path>]
 *     Fetches sprint data and renders a colored board to stdout using ANSI codes.
 *     Combines get-sprint + get-sprint-items + rendering in a single command.
 *     --me: Filter to items assigned to the authenticated user.
 *     stdout: ANSI-colored sprint board text
 *     Exit 0 on success, exit 1 on error.
 *
 *   add-comment --id <workItemId> --text "<html>" [--cwd <path>]
 *     Adds a comment (Discussion) to a work item using the Comments API.
 *     The text field accepts HTML for rich formatting (headings, tables, lists).
 *     stdout: JSON {"status":"created","id":N,"commentId":N}
 *     Exit 0 on success, exit 1 on error.
 *
 *   delete-comment --id <workItemId> --comment-id <commentId> [--cwd <path>]
 *     Deletes a comment from a work item.
 *     stdout: JSON {"status":"deleted","id":N,"commentId":N}
 *     Exit 0 on success, exit 1 on error.
 *
 *   create-work-item --type <type> --title <title> [--description "<html>"] [--parent <id>] [--sprint] [--assigned-to "<name>"] [--area "<path>"] [--tags "<comma-separated>"] [--cwd <path>]
 *     Creates a new work item (User Story, Task, Bug, Feature, or Epic).
 *     Uses POST to _apis/wit/workitems/$<type> with JSON Patch body.
 *     --sprint: assigns to current active sprint iteration.
 *     --parent: links the new item as a child of the given work item ID.
 *     stdout: JSON {"status":"created","id":N,"type":"...","title":"...","url":"..."}
 *     Exit 0 on success, exit 1 on error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ─── Config Helpers ────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the devsprint-config.json file for the given cwd.
 * @param {string} cwd - Working directory (project root)
 * @returns {string} Absolute path to devsprint-config.json
 */
function getConfigPath(cwd) {
  return path.join(cwd, '.planning', 'devsprint-config.json');
}

/**
 * Normalizes an org input to a full base URL (no trailing slash).
 * Handles:
 *   "https://dev.azure.com/myorg/" -> "https://dev.azure.com/myorg"
 *   "https://verdo365.visualstudio.com/" -> "https://verdo365.visualstudio.com"
 *   "myorg" -> "https://dev.azure.com/myorg"
 * @param {string} input - Raw org input from user
 * @returns {string} Full base URL for API calls
 */
function normaliseOrg(input) {
  if (!input) return input;
  let s = input.trim();

  // Remove trailing slashes
  s = s.replace(/\/+$/, '');

  // Already a full URL — return as-is (covers dev.azure.com, visualstudio.com, on-prem)
  if (/^https?:\/\//i.test(s)) {
    return s;
  }

  // Plain slug — default to dev.azure.com
  return `https://dev.azure.com/${s}`;
}

/**
 * Loads and parses devsprint-config.json, decoding the PAT from base64.
 * @param {string} cwd - Working directory (project root)
 * @returns {{org: string, project: string, pat: string}} Config with raw PAT
 * @throws {Error} If config file is missing or malformed
 */
function loadConfig(cwd) {
  const configPath = getConfigPath(cwd);
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No Azure DevOps config found at ${configPath}. Run /devsprint-setup to configure.`
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read config file: ${err.message}`);
  }

  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config file is not valid JSON: ${err.message}. Run /devsprint-setup to reconfigure.`);
  }

  if (!cfg.org || !cfg.project || !cfg.pat) {
    throw new Error(`Config file is missing required fields (org, project, pat). Run /devsprint-setup to reconfigure.`);
  }

  // Decode PAT: base64 -> ":rawpat" -> slice leading colon
  const decoded = Buffer.from(cfg.pat, 'base64').toString('utf-8');
  const rawPat = decoded.startsWith(':') ? decoded.slice(1) : decoded;

  return { org: cfg.org, project: cfg.project, pat: rawPat, team: cfg.team || null, area: cfg.area || null };
}

/**
 * Saves Azure DevOps config to .planning/devsprint-config.json.
 * Normalizes org URL to slug, encodes PAT as base64 with leading colon.
 * @param {string} cwd - Working directory (project root)
 * @param {{org: string, project: string, pat: string, team?: string, area?: string}} config - Config values (raw PAT)
 */
function saveConfig(cwd, { org, project, pat, team, area }) {
  const normalizedOrg = normaliseOrg(org);
  // Encode PAT: prepend colon (empty username), then base64 encode
  const encodedPat = Buffer.from(':' + pat).toString('base64');

  const configPath = getConfigPath(cwd);
  const planningDir = path.dirname(configPath);

  // Ensure .planning directory exists
  if (!fs.existsSync(planningDir)) {
    fs.mkdirSync(planningDir, { recursive: true });
  }

  const configData = {
    org: normalizedOrg,
    project: project,
    pat: encodedPat,
  };
  if (team) configData.team = team;
  if (area) configData.area = area;

  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8');

  return { org: normalizedOrg, project };
}

// ─── HTTP Helper ───────────────────────────────────────────────────────────────

/**
 * Makes an authenticated HTTPS request to Azure DevOps.
 * @param {string} url - Full URL to request
 * @param {string} encodedPat - Base64-encoded PAT (for Authorization: Basic header)
 * @param {string} [method='GET'] - HTTP method
 * @param {object|null} [body=null] - Request body (JSON-serializable)
 * @returns {Promise<{status: number, body: string}>} Response status and body
 */
function makeRequest(url, encodedPat, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Authorization': `Basic ${encodedPat}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error connecting to Azure DevOps: ${err.message}`));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }

    req.end();
  });
}

/**
 * Makes an authenticated HTTPS PATCH request using application/json-patch+json content type.
 * Required by Azure DevOps Work Item Tracking API for field updates.
 * @param {string} url - Full URL to request
 * @param {string} encodedPat - Base64-encoded PAT (for Authorization: Basic header)
 * @param {Array} patchBody - JSON Patch operations array
 * @returns {Promise<{status: number, body: string}>} Response status and body
 */
function makePatchRequest(url, encodedPat, patchBody) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = JSON.stringify(patchBody);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'PATCH',
      headers: {
        'Authorization': `Basic ${encodedPat}`,
        'Content-Type': 'application/json-patch+json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error connecting to Azure DevOps: ${err.message}`));
    });

    req.write(bodyStr);
    req.end();
  });
}

// ─── Sprint Helpers ────────────────────────────────────────────────────────────

/**
 * Strips HTML tags and decodes common HTML entities from a string.
 * Used to clean Description and AcceptanceCriteria fields from Azure DevOps
 * before displaying them in the terminal.
 * @param {string|null} html - HTML string to strip
 * @returns {string} Plain text with HTML removed
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolves the Azure DevOps team name for the given project.
 * Step 1: Try using the decoded project name as the team name (default team convention).
 *         A 200 response with a valid body means the team name works.
 * Step 2: Fall back to listing teams via the Core API and using the first team.
 * Step 3: Throw if neither approach works.
 * @param {string} org - Organisation base URL
 * @param {string} encodedProject - URL-encoded project name (as stored in config)
 * @param {string} encodedPat - Base64-encoded PAT
 * @returns {Promise<string>} Resolved team name (URL-decoded)
 */
async function resolveTeamName(org, encodedProject, encodedPat) {
  // Step 1: Try project name as team name (Azure DevOps default team convention)
  const decodedProject = decodeURIComponent(encodedProject);
  const testUrl = `${org}/${encodedProject}/${encodeURIComponent(decodedProject)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
  const res = await makeRequest(testUrl, encodedPat);
  if (res.status === 200) {
    const data = JSON.parse(res.body);
    if (data.value !== undefined) {
      // 200 with valid response means the team name works (value may be empty if no active sprint)
      return decodedProject;
    }
  }

  // Step 2: Fall back to listing teams and using the first one
  const teamsUrl = `${org}/_apis/projects/${encodedProject}/teams?$top=1&api-version=7.1`;
  const teamsRes = await makeRequest(teamsUrl, encodedPat);
  if (teamsRes.status === 200) {
    const teams = JSON.parse(teamsRes.body);
    if (teams.value && teams.value.length > 0) {
      return teams.value[0].name;
    }
  }

  throw new Error('Could not resolve team name. Check that the project has at least one team configured.');
}

/**
 * Shared sprint data fetch logic used by both get-sprint and get-sprint-items.
 * Loads config, re-encodes PAT, resolves team name, fetches the current sprint iteration.
 * @param {string} cwd - Working directory (project root)
 * @returns {Promise<{cfg: object, encodedPat: string, teamName: string, iteration: object}>}
 */
async function getSprintData(cwd) {
  const cfg = loadConfig(cwd);
  const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');
  const teamName = cfg.team || await resolveTeamName(cfg.org, cfg.project, encodedPat);

  const iterationsUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
  const res = await makeRequest(iterationsUrl, encodedPat);

  if (res.status !== 200) {
    throw new Error(`Failed to fetch sprint iterations: HTTP ${res.status}`);
  }

  const data = JSON.parse(res.body);
  if (!data.value || data.value.length === 0) {
    throw new Error('No active sprint found. Check that a sprint with today\'s date range is active in Azure DevOps.');
  }

  return { cfg, encodedPat, teamName, iteration: data.value[0] };
}

// ─── Branch Link Helpers ───────────────────────────────────────────────────────

/**
 * Parses a vstfs:///Git/Ref/ URI into its component parts.
 * Format: vstfs:///Git/Ref/{projectId}/{repositoryId}/GB{branchName}
 * Branch names may contain forward slashes (e.g., feature/US-1234-add-checkout).
 * @param {string} vstfsUrl - The vstfs URI from a work item ArtifactLink relation
 * @returns {{projectId: string, repositoryId: string, branchName: string}}
 */
function parseVstfsRefUri(vstfsUrl) {
  const path = decodeURIComponent(vstfsUrl.replace('vstfs:///Git/Ref/', ''));
  const parts = path.split('/');
  const projectId = parts[0];
  const repositoryId = parts[1];
  // Branch name: join remaining parts (handles slashes in branch names), strip GB prefix
  const branchRaw = parts.slice(2).join('/');
  const branchName = branchRaw.startsWith('GB') ? branchRaw.slice(2) : branchRaw;
  return { projectId, repositoryId, branchName };
}

/**
 * Looks up a Git repository by ID using the Azure DevOps Git Repositories API.
 * First tries project-scoped lookup; falls back to org-level if 404 (handles cross-project repos).
 * @param {string} org - Organisation base URL
 * @param {string} project - Project name (URL-encoded)
 * @param {string} repositoryId - Repository GUID
 * @param {string} encodedPat - Base64-encoded PAT
 * @returns {Promise<{id: string, name: string, remoteUrl: string, defaultBranch: string}>}
 * @throws {Error} If both project-scoped and org-level lookups fail
 */
async function resolveRepository(org, project, repositoryId, encodedPat) {
  const projectUrl = `${org}/${project}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
  const res = await makeRequest(projectUrl, encodedPat);
  if (res.status === 200) return JSON.parse(res.body);

  // Fallback: org-level lookup (handles cross-project repos — Pitfall 4)
  const orgUrl = `${org}/_apis/git/repositories/${repositoryId}?api-version=7.1`;
  const fallbackRes = await makeRequest(orgUrl, encodedPat);
  if (fallbackRes.status === 200) return JSON.parse(fallbackRes.body);

  throw new Error(`Repository ${repositoryId} not found (HTTP ${res.status} project-scoped, HTTP ${fallbackRes.status} org-level)`);
}

// ─── CLI Commands ──────────────────────────────────────────────────────────────

/**
 * Handles the get-sprint command.
 * Fetches the current active sprint and outputs its metadata as JSON.
 * @param {string} cwd - Working directory
 */
async function cmdGetSprint(cwd) {
  try {
    const { iteration } = await getSprintData(cwd);
    const output = {
      iterationId: iteration.id,
      name: iteration.name,
      path: iteration.path,
      startDate: iteration.attributes ? iteration.attributes.startDate : null,
      finishDate: iteration.attributes ? iteration.attributes.finishDate : null,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Fetches the authenticated user's display name from Azure DevOps connection data.
 * @param {string} org - Organisation base URL
 * @param {string} encodedPat - Base64-encoded PAT
 * @returns {Promise<string>} The authenticated user's display name
 */
async function getAuthenticatedUser(org, encodedPat) {
  const res = await makeRequest(`${org}/_apis/connectiondata`, encodedPat);
  if (res.status !== 200) {
    throw new Error(`Failed to fetch connection data: HTTP ${res.status}`);
  }
  const data = JSON.parse(res.body);
  if (!data.authenticatedUser || !data.authenticatedUser.providerDisplayName) {
    throw new Error('Could not determine authenticated user from connection data.');
  }
  return data.authenticatedUser.providerDisplayName;
}

/**
 * Handles the get-sprint-items command.
 * Fetches all work items in the current sprint and outputs them as a JSON array.
 * Each item includes id, type, title, state, description (HTML stripped),
 * acceptanceCriteria (HTML stripped), parentId, and assignedTo.
 * Supports --me flag to filter to items assigned to the authenticated user.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdGetSprintItems(cwd, args) {
  const mine = args && args.includes('--me');
  try {
    const { cfg, encodedPat, teamName, iteration } = await getSprintData(cwd);

    // Step 1: Fetch work item IDs for the sprint
    const workItemsUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?api-version=7.1`;
    const wiRes = await makeRequest(workItemsUrl, encodedPat);

    if (wiRes.status !== 200) {
      throw new Error(`Failed to fetch sprint work items: HTTP ${wiRes.status}`);
    }

    const wiData = JSON.parse(wiRes.body);

    // Step 2: Extract all unique IDs from workItemRelations (both source and target)
    const idSet = new Set();
    for (const rel of (wiData.workItemRelations || [])) {
      if (rel.target) idSet.add(rel.target.id);
      if (rel.source) idSet.add(rel.source.id);
    }
    const ids = Array.from(idSet);

    // Step 3: Handle empty sprint
    if (ids.length === 0) {
      console.log(JSON.stringify([]));
      process.exit(0);
    }

    // Step 4: Warn if over 200 items (batch limit)
    let batchIds = ids;
    if (ids.length > 200) {
      console.error(`Warning: Sprint has ${ids.length} work items, showing first 200.`);
      batchIds = ids.slice(0, 200);
    }

    // Step 5: Batch fetch full work item details
    const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
    const batchBody = {
      ids: batchIds,
      fields: [
        'System.Id',
        'System.Title',
        'System.WorkItemType',
        'System.State',
        'System.Description',
        'Microsoft.VSTS.Common.AcceptanceCriteria',
        'System.Parent',
        'System.AssignedTo',
        'System.Tags',
      ],
      errorPolicy: 'omit',
    };
    const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);

    if (batchRes.status !== 200) {
      throw new Error(`Failed to batch fetch work item details: HTTP ${batchRes.status}`);
    }

    const batchData = JSON.parse(batchRes.body);

    // Step 6: Map to output format, stripping HTML from description and acceptanceCriteria
    let items = (batchData.value || []).map((item) => {
      const assignedTo = item.fields['System.AssignedTo'];
      return {
        id: item.id,
        type: item.fields['System.WorkItemType'],
        title: item.fields['System.Title'],
        state: item.fields['System.State'],
        description: stripHtml(item.fields['System.Description'] || ''),
        acceptanceCriteria: stripHtml(item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
        parentId: item.fields['System.Parent'] || null,
        assignedTo: assignedTo ? assignedTo.displayName : null,
        tags: item.fields['System.Tags'] ? item.fields['System.Tags'].split('; ') : [],
      };
    });

    // Step 7: Filter to current user's items if --me flag
    if (mine) {
      const currentUser = await getAuthenticatedUser(cfg.org, encodedPat);
      // Collect IDs of items assigned to the current user
      const myItemIds = new Set(items.filter(i => i.assignedTo === currentUser).map(i => i.id));
      // Also include parent stories of my tasks, and child tasks of my stories
      const myParentIds = new Set(items.filter(i => myItemIds.has(i.id) && i.parentId).map(i => i.parentId));
      const myChildIds = new Set(items.filter(i => myItemIds.has(i.parentId)).map(i => i.id));
      const allMyIds = new Set([...myItemIds, ...myParentIds, ...myChildIds]);
      items = items.filter(i => allMyIds.has(i.id));
    }

    console.log(JSON.stringify(items));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the get-work-item command.
 * Fetches a single work item by ID with its children.
 * stdout: JSON array (same format as get-sprint-items but for a single story + children)
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdGetWorkItem(cwd, args) {
  const idArg = args.find(a => /^\d+$/.test(a));
  if (!idArg) {
    console.error('Usage: devsprint-tools.cjs get-work-item <id> [--cwd <path>]');
    process.exit(1);
  }
  const workItemId = parseInt(idArg, 10);
  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // Fetch the work item + children via WIQL
    const wiqlUrl = `${cfg.org}/${cfg.project}/_apis/wit/wiql?api-version=7.1`;
    const wiqlBody = {
      query: `SELECT [System.Id] FROM WorkItemLinks WHERE ([Source].[System.Id] = ${workItemId} OR [Target].[System.Parent] = ${workItemId}) AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (Recursive)`
    };
    const wiqlRes = await makeRequest(wiqlUrl, encodedPat, 'POST', wiqlBody);

    let ids = [workItemId];
    if (wiqlRes.status === 200) {
      const wiqlData = JSON.parse(wiqlRes.body);
      for (const rel of (wiqlData.workItemRelations || [])) {
        if (rel.target) ids.push(rel.target.id);
        if (rel.source) ids.push(rel.source.id);
      }
      ids = [...new Set(ids)];
    }

    // Batch fetch full details
    const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
    const batchBody = {
      ids,
      fields: [
        'System.Id', 'System.Title', 'System.WorkItemType', 'System.State',
        'System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria',
        'System.Parent', 'System.AssignedTo', 'System.Tags',
      ],
      errorPolicy: 'omit',
    };
    const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
    if (batchRes.status !== 200) {
      throw new Error(`Failed to fetch work item details: HTTP ${batchRes.status}`);
    }

    const batchData = JSON.parse(batchRes.body);
    const items = (batchData.value || []).map((item) => {
      const assignedTo = item.fields['System.AssignedTo'];
      return {
        id: item.id,
        type: item.fields['System.WorkItemType'],
        title: item.fields['System.Title'],
        state: item.fields['System.State'],
        description: stripHtml(item.fields['System.Description'] || ''),
        acceptanceCriteria: stripHtml(item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
        parentId: item.fields['System.Parent'] || null,
        assignedTo: assignedTo ? assignedTo.displayName : null,
        tags: item.fields['System.Tags'] ? item.fields['System.Tags'].split('; ') : [],
      };
    });

    console.log(JSON.stringify(items));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the save-config command.
 * Parses --org, --project, --pat from args, validates, saves config, outputs JSON.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdSaveConfig(cwd, args) {
  const orgIdx = args.indexOf('--org');
  const projectIdx = args.indexOf('--project');
  const patIdx = args.indexOf('--pat');
  const teamIdx = args.indexOf('--team');
  const areaIdx = args.indexOf('--area');

  const org = orgIdx !== -1 ? args[orgIdx + 1] : null;
  const project = projectIdx !== -1 ? args[projectIdx + 1] : null;
  const pat = patIdx !== -1 ? args[patIdx + 1] : null;
  const team = teamIdx !== -1 ? args[teamIdx + 1] : null;
  const area = areaIdx !== -1 ? args[areaIdx + 1] : null;

  const missing = [];
  if (!org) missing.push('--org');
  if (!project) missing.push('--project');
  if (!pat) missing.push('--pat');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs save-config --org <org> --project <project> --pat <pat> [--team <team>] [--area <area>] [--cwd <path>]');
    process.exit(1);
  }

  const result = saveConfig(cwd, { org, project, pat, team, area });
  console.log(JSON.stringify({ status: 'saved', org: result.org, project: result.project, team: team || null, area: area || null }));
  process.exit(0);
}

/**
 * Handles the list-teams command.
 * Lists all teams in the project.
 * stdout: JSON array [{"name":"...","id":"..."}]
 * @param {string} cwd - Working directory
 */
async function cmdListTeams(cwd) {
  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const url = `${cfg.org}/_apis/projects/${cfg.project}/teams?$top=100&api-version=7.1`;
    const res = await makeRequest(url, encodedPat);

    if (res.status !== 200) {
      throw new Error(`Failed to list teams: HTTP ${res.status}`);
    }

    const data = JSON.parse(res.body);
    const teams = (data.value || []).map(t => ({ name: t.name, id: t.id }));
    console.log(JSON.stringify(teams));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the get-team-area command.
 * Resolves the default area path for a given team using the Team Field Values API.
 * stdout: JSON {"team":"...","area":"..."}
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args (--team <name>)
 */
async function cmdGetTeamArea(cwd, args) {
  const teamIdx = args.indexOf('--team');
  const teamName = teamIdx !== -1 ? args[teamIdx + 1] : null;

  if (!teamName) {
    console.error('Missing required argument: --team');
    console.error('Usage: devsprint-tools.cjs get-team-area --team "<team name>" [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const url = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/teamfieldvalues?api-version=7.1`;
    const res = await makeRequest(url, encodedPat);

    if (res.status !== 200) {
      throw new Error(`Failed to get team area for "${teamName}": HTTP ${res.status}`);
    }

    const data = JSON.parse(res.body);
    console.log(JSON.stringify({ team: teamName, area: data.defaultValue || null }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the report-status command.
 * Writes agent status to .planning/devsprint-agent-status.json for dashboard consumption.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args: --story-id, --story-title, --step, --detail, --repo, --branch, --command
 */
function cmdReportStatus(cwd, args) {
  const get = (name) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

  const statusPath = path.join(cwd, '.planning', 'devsprint-agent-status.json');
  const planningDir = path.dirname(statusPath);
  if (!fs.existsSync(planningDir)) fs.mkdirSync(planningDir, { recursive: true });

  // Read existing status to preserve history
  let existing = { active: null, history: [] };
  try {
    if (fs.existsSync(statusPath)) existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {}

  const storyId = get('--story-id');
  const now = new Date().toISOString();

  // Build top-level status (reflects most recent update)
  const newStep = get('--step') || 'unknown';
  const status = {
    storyId: storyId ? parseInt(storyId, 10) : (existing.active ? existing.active.storyId : null),
    storyTitle: get('--story-title') || (existing.active ? existing.active.storyTitle : null),
    step: newStep,
    detail: get('--detail') || null,
    repo: get('--repo') || (existing.active ? existing.active.repo : null),
    branch: get('--branch') || (existing.active ? existing.active.branch : null),
    command: get('--command') || null,
    startedAt: existing.active ? existing.active.startedAt : now,
    updatedAt: now,
    // Preserve per-story tracking map from previous state
    stories: existing.active && existing.active.stories ? { ...existing.active.stories } : {},
    // Accumulate step log
    stepLog: existing.active && existing.active.stepLog ? [...existing.active.stepLog] : [],
  };
  // Append to step log if step changed from last entry
  const lastLog = status.stepLog.length ? status.stepLog[status.stepLog.length - 1] : null;
  if (!lastLog || lastLog.step !== newStep) {
    status.stepLog.push({ step: newStep, detail: get('--detail') || null, at: now, storyId: storyId ? parseInt(storyId, 10) : null });
  }

  // If story-id is provided, upsert into per-story map
  if (storyId) {
    const sid = String(storyId);
    const prev = status.stories[sid];
    status.stories[sid] = {
      storyId: parseInt(storyId, 10),
      storyTitle: get('--story-title') || (prev ? prev.storyTitle : null),
      step: get('--step') || 'unknown',
      detail: get('--detail') || null,
      updatedAt: now,
    };
  }

  const output = { active: status, history: existing.history || [] };
  fs.writeFileSync(statusPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(JSON.stringify({ status: 'reported', step: status.step }));
  process.exit(0);
}

/**
 * Handles the clear-status command.
 * Archives the current active status and clears it.
 * @param {string} cwd - Working directory
 */
function cmdClearStatus(cwd) {
  const statusPath = path.join(cwd, '.planning', 'devsprint-agent-status.json');
  let existing = { active: null, history: [] };
  try {
    if (fs.existsSync(statusPath)) existing = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  } catch {}

  if (existing.active) {
    const archived = { ...existing.active, endedAt: new Date().toISOString() };
    // Mark as Done so dashboard knows this run completed successfully
    archived.step = 'Done';
    if (archived.stepLog) {
      const lastLog = archived.stepLog.length ? archived.stepLog[archived.stepLog.length - 1] : null;
      if (!lastLog || lastLog.step !== 'Done') {
        archived.stepLog.push({ step: 'Done', detail: null, at: new Date().toISOString(), storyId: archived.storyId || null });
      }
    }
    existing.history.unshift(archived);
    if (existing.history.length > 50) existing.history = existing.history.slice(0, 50);
  }
  existing.active = null;
  fs.writeFileSync(statusPath, JSON.stringify(existing, null, 2), 'utf-8');
  console.log(JSON.stringify({ status: 'cleared' }));
  process.exit(0);
}

/**
 * Handles the load-config command.
 * Loads config and outputs JSON with decoded PAT.
 * @param {string} cwd - Working directory
 */
async function cmdLoadConfig(cwd) {
  let cfg;
  try {
    cfg = loadConfig(cwd);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(JSON.stringify({ org: cfg.org, project: cfg.project, pat: cfg.pat }));
  process.exit(0);
}

/**
 * Handles the test command.
 * Loads config, makes two API requests to verify auth + scopes.
 * @param {string} cwd - Working directory
 */
async function cmdTest(cwd) {
  let cfg;
  try {
    cfg = loadConfig(cwd);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const { org, project, pat } = cfg;
  // Re-encode PAT for the Authorization header
  const encodedPat = Buffer.from(':' + pat).toString('base64');

  // Step 1: Verify auth + vso.project scope
  let projectsRes;
  try {
    projectsRes = await makeRequest(
      `${org}/_apis/projects?$top=1&api-version=7.1`,
      encodedPat
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (projectsRes.status === 401) {
    console.error('Authentication failed. Check your PAT is correct and has not expired. Run /devsprint-setup to reconfigure.');
    process.exit(1);
  }

  if (projectsRes.status === 403) {
    console.error('Authorisation denied. Check your PAT has the vso.project scope. Run /devsprint-setup to reconfigure.');
    process.exit(1);
  }

  if (projectsRes.status !== 200) {
    console.error(`Unexpected response: HTTP ${projectsRes.status}`);
    process.exit(1);
  }

  // Step 2: Verify vso.work scope
  let workItemsRes;
  try {
    workItemsRes = await makeRequest(
      `${org}/${project}/_apis/wit/workitems?ids=1&api-version=7.1`,
      encodedPat
    );
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // 404 is acceptable (item not found = auth is OK, just no item with id=1)
  // Only 401/403 means scope is missing
  if (workItemsRes.status === 401 || workItemsRes.status === 403) {
    console.error('Authentication succeeded but work items access denied. Check your PAT has the vso.work scope. Run /devsprint-setup to reconfigure.');
    process.exit(1);
  }

  if (workItemsRes.status !== 200 && workItemsRes.status !== 404) {
    console.error(`Unexpected response: HTTP ${workItemsRes.status}`);
    process.exit(1);
  }

  console.log(`Connected to ${org}/${project}`);
  process.exit(0);
}

/**
 * Handles the get-branch-links command.
 * Fetches branch artifact links from a work item and resolves them to repository details.
 * Returns [] if no branch link found (exit 0), or throws on API error (exit 1).
 * Required PAT scopes: vso.work + vso.code
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdGetBranchLinks(cwd, args) {
  const idIdx = args.indexOf('--id');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  if (!id) {
    console.error('Missing --id');
    console.error('Usage: azdo-tools.cjs get-branch-links --id <workItemId> [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // Step 1: Fetch work item with expanded relations
    const wiUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`;
    const wiRes = await makeRequest(wiUrl, encodedPat);
    if (wiRes.status !== 200) {
      throw new Error(`Failed to fetch work item ${id}: HTTP ${wiRes.status}`);
    }
    const workItem = JSON.parse(wiRes.body);

    // Step 2: Filter for branch ArtifactLinks using URL-based filter (more reliable than attributes.name)
    // Per Pitfall 1: check vstfs:///Git/Ref/ prefix rather than attributes.name === 'Branch'
    const branchLinks = (workItem.relations || []).filter(r =>
      r.rel === 'ArtifactLink' && r.url && r.url.startsWith('vstfs:///Git/Ref/')
    );

    if (branchLinks.length === 0) {
      console.log(JSON.stringify([]));
      process.exit(0);
    }

    // Step 3: Resolve repository details for each branch link
    const results = [];
    for (const link of branchLinks) {
      const { repositoryId, branchName } = parseVstfsRefUri(link.url);
      try {
        const repo = await resolveRepository(cfg.org, cfg.project, repositoryId, encodedPat);
        results.push({
          repositoryId: repo.id,
          repositoryName: repo.name,
          remoteUrl: repo.remoteUrl,
          branchName,
        });
      } catch (repoErr) {
        // Skip repos that fail to resolve — warn to stderr but continue with others
        console.error(`Warning: Could not resolve repository ${repositoryId}: ${repoErr.message}`);
      }
    }

    console.log(JSON.stringify(results));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the update-description command.
 * Updates the Description field of a work item using the JSON Patch API.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdUpdateDescription(cwd, args) {
  const idIdx = args.indexOf('--id');
  const descIdx = args.indexOf('--description');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const description = descIdx !== -1 ? args[descIdx + 1] : null;

  const missing = [];
  if (!id) missing.push('--id');
  if (!description && description !== '') missing.push('--description');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: azdo-tools.cjs update-description --id <workItemId> --description "<text>" [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const patchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?api-version=7.1`;
    const patchBody = [
      {
        op: 'replace',
        path: '/fields/System.Description',
        value: description,
      },
    ];

    const res = await makePatchRequest(patchUrl, encodedPat, patchBody);

    if (res.status === 200) {
      console.log(JSON.stringify({ status: 'updated', id: Number(id) }));
      process.exit(0);
    } else {
      const errorBody = res.body ? JSON.parse(res.body) : {};
      throw new Error(`Failed to update work item ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the update-acceptance-criteria command.
 * Updates the Microsoft.VSTS.Common.AcceptanceCriteria field of a work item.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdUpdateAcceptanceCriteria(cwd, args) {
  const idIdx = args.indexOf('--id');
  const criteriaIdx = args.indexOf('--criteria');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const criteria = criteriaIdx !== -1 ? args[criteriaIdx + 1] : null;

  const missing = [];
  if (!id) missing.push('--id');
  if (!criteria && criteria !== '') missing.push('--criteria');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs update-acceptance-criteria --id <workItemId> --criteria "<html>" [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const patchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?api-version=7.1`;
    const patchBody = [
      {
        op: 'replace',
        path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
        value: criteria,
      },
    ];

    const res = await makePatchRequest(patchUrl, encodedPat, patchBody);

    if (res.status === 200) {
      console.log(JSON.stringify({ status: 'updated', id: Number(id) }));
      process.exit(0);
    } else {
      const errorBody = res.body ? JSON.parse(res.body) : {};
      throw new Error(`Failed to update acceptance criteria for work item ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the update-state command.
 * Changes the System.State field of a work item via the JSON Patch API.
 * Uses op:add (not replace) per Azure DevOps API convention for System.State.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdUpdateState(cwd, args) {
  const idIdx = args.indexOf('--id');
  const stateIdx = args.indexOf('--state');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const state = stateIdx !== -1 ? args[stateIdx + 1] : null;

  const missing = [];
  if (!id) missing.push('--id');
  if (!state) missing.push('--state');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: azdo-tools.cjs update-state --id <workItemId> --state <state> [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const patchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?api-version=7.1`;
    const patchBody = [
      {
        op: 'add',
        path: '/fields/System.State',
        value: state,
      },
    ];

    const res = await makePatchRequest(patchUrl, encodedPat, patchBody);

    if (res.status === 200) {
      console.log(JSON.stringify({ status: 'updated', id: Number(id), state }));
      process.exit(0);
    } else if (res.status === 400) {
      let errorBody = {};
      try { errorBody = JSON.parse(res.body); } catch (_) {}
      console.error(`Invalid state transition for work item ${id}: ${errorBody.message || res.body}. Check that '${state}' is a valid target state.`);
      process.exit(1);
    } else if (res.status === 403) {
      console.error(`Status update failed for work item ${id}: PAT needs vso.work_write scope. Regenerate at https://dev.azure.com/_usersSettings/tokens and re-run /devsprint-setup.`);
      process.exit(1);
    } else {
      let errorBody = {};
      try { errorBody = JSON.parse(res.body); } catch (_) {}
      console.error(`Failed to update state for work item ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the get-child-states command.
 * Fetches all child task states for a given parent story.
 * Determines allResolved: true when every child is in Resolved, Closed, or Done state.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdGetChildStates(cwd, args) {
  const idIdx = args.indexOf('--id');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;

  if (!id) {
    console.error('Missing required arguments: --id');
    console.error('Usage: azdo-tools.cjs get-child-states --id <storyId> [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // Step 1: GET work item with expanded relations
    const wiUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/${id}?$expand=relations&api-version=7.1`;
    const wiRes = await makeRequest(wiUrl, encodedPat);
    if (wiRes.status !== 200) {
      throw new Error(`Failed to fetch work item ${id}: HTTP ${wiRes.status}`);
    }
    const workItem = JSON.parse(wiRes.body);

    // Step 2: Filter relations to Hierarchy-Forward children, extract IDs from URL
    const childLinks = (workItem.relations || []).filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward');
    const childIds = childLinks.map(r => {
      const parts = r.url.split('/');
      return Number(parts[parts.length - 1]);
    }).filter(n => !isNaN(n));

    // Step 3: No children — all resolved by definition
    if (childIds.length === 0) {
      console.log(JSON.stringify({ allResolved: true, children: [] }));
      process.exit(0);
    }

    // Step 4: Batch GET child states
    const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
    const batchBody = {
      ids: childIds,
      fields: ['System.Id', 'System.Title', 'System.State'],
      errorPolicy: 'omit',
    };
    const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
    if (batchRes.status !== 200) {
      throw new Error(`Failed to batch fetch child work items: HTTP ${batchRes.status}`);
    }
    const batchData = JSON.parse(batchRes.body);

    // Step 5: Map to output format
    const children = (batchData.value || []).map(item => ({
      id: item.fields['System.Id'],
      title: item.fields['System.Title'],
      state: item.fields['System.State'],
    }));

    // Step 6: Determine allResolved — accept Resolved, Closed, and Done as completed states
    const resolvedStates = new Set(['Resolved', 'Closed', 'Done']);
    const allResolved = children.length > 0 && children.every(c => resolvedStates.has(c.state));

    console.log(JSON.stringify({ allResolved, children }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// ─── Sprint Rendering ───────────────────────────────────────────────────────────

/**
 * Renders a sprint board with ANSI colors given sprint metadata and items.
 * Pure rendering function — no I/O, returns array of lines.
 * @param {object} sprint - Sprint metadata (name, path, startDate, finishDate)
 * @param {Array} items - Work items array from get-sprint-items
 * @returns {string[]} Lines of ANSI-colored output
 */
function renderSprintBoard(sprint, items, options = {}) {
  const detailed = options.detailed || false;
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const WHITE = '\x1b[37m';
  const CYAN = '\x1b[36m';
  const BLUE = '\x1b[34m';
  const GREEN = '\x1b[32m';
  const RED = '\x1b[31m';
  const YELLOW = '\x1b[33m';
  const MAGENTA = '\x1b[35m';

  function stateColor(state) {
    switch (state) {
      case 'New': return CYAN;
      case 'Active': return BLUE;
      case 'Resolved': return GREEN;
      case 'Closed': case 'Done': return GREEN + BOLD;
      case 'Removed': return RED;
      default: return YELLOW;
    }
  }

  function stateLabel(state) {
    switch (state) {
      case 'Closed': case 'Done': return 'DONE';
      default: return state ? state.toUpperCase() : 'UNKNOWN';
    }
  }

  function typeAbbrev(type) {
    if (type === 'User Story') return 'US';
    return type || 'Item';
  }

  function formatDate(d) {
    if (!d) return 'not set';
    return String(d).slice(0, 10);
  }

  // Use the module-level stripHtml for description/AC fields
  const lines = [];
  const push = (l) => lines.push(l);

  // Sprint header
  push('');
  push(`${BOLD}${CYAN}━━━ Sprint: ${sprint.name || 'Unknown'} ━━━${RESET}`);
  push(`${DIM}Iteration:${RESET} ${sprint.path || 'N/A'}`);
  push(`${DIM}Dates:${RESET}     ${formatDate(sprint.startDate)} → ${formatDate(sprint.finishDate)}`);
  push(`${DIM}Items:${RESET}     ${items.length}`);
  push('');

  if (items.length === 0) {
    push('No work items in this sprint.');
    return lines;
  }

  // Build parent-child grouping
  const itemMap = new Map();
  items.forEach(item => itemMap.set(item.id, item));

  const topLevel = [];
  const childrenOf = new Map();

  items.forEach(item => {
    if (item.parentId && itemMap.has(item.parentId)) {
      if (!childrenOf.has(item.parentId)) childrenOf.set(item.parentId, []);
      childrenOf.get(item.parentId).push(item);
    } else {
      topLevel.push(item);
    }
  });

  // Classify stories into status groups
  const doneStatesSet = new Set(['Resolved', 'Closed', 'Done']);
  const groups = {
    blocked:   { label: 'Blokeret',  icon: '⊘', color: RED,    stories: [] },
    active:    { label: 'I gang',    icon: '▶', color: BLUE,   stories: [] },
    planned:   { label: 'Ny',        icon: '○', color: CYAN,   stories: [] },
    completed: { label: 'Afsluttet', icon: '✓', color: GREEN,  stories: [] },
  };

  for (const story of topLevel) {
    if (story.title && story.title.toUpperCase().includes('BLOKERET')) {
      groups.blocked.stories.push(story);
    } else if (doneStatesSet.has(story.state)) {
      groups.completed.stories.push(story);
    } else if (story.state === 'Active') {
      groups.active.stories.push(story);
    } else {
      groups.planned.stories.push(story);
    }
  }

  // Render each group that has stories
  const groupOrder = ['active', 'planned', 'blocked', 'completed'];

  function renderStory(story) {
    const sc = stateColor(story.state);
    const abbrev = typeAbbrev(story.type);
    const assigned = story.assignedTo || 'Unassigned';

    push(`${BOLD}${sc}┌─ [${abbrev}] #${story.id} — ${story.title}${RESET}`);
    push(`│  State: ${sc}${stateLabel(story.state)}${RESET}  │  Assigned: ${assigned}`);

    if (detailed) {
      // Description (first 3 lines) — items already have HTML stripped by get-sprint-items
      const desc = story.description || '';
      if (desc) {
        const descLines = desc.split('\n').filter(l => l.trim()).slice(0, 3);
        for (const dl of descLines) {
          push(`│  ${DIM}${dl}${RESET}`);
        }
      } else {
        push(`│  ${DIM}(no description)${RESET}`);
      }

      // Acceptance criteria
      const ac = story.acceptanceCriteria || '';
      if (ac) {
        push('│');
        push(`│  ${MAGENTA}Acceptance Criteria:${RESET}`);
        const acLines = ac.split('\n').filter(l => l.trim());
        for (const al of acLines) {
          push(`│  ${DIM}${al}${RESET}`);
        }
      } else {
        push('│');
        push(`│  ${MAGENTA}Acceptance Criteria:${RESET}`);
        push(`│  ${DIM}(no acceptance criteria)${RESET}`);
      }
    }

    // Child tasks
    const allChildren = childrenOf.get(story.id) || [];
    const children = detailed ? allChildren : allChildren.filter(c => !doneStatesSet.has(c.state));
    const hiddenCount = allChildren.length - children.length;
    if (children.length > 0) {
      push('│');
      for (const child of children) {
        const cc = stateColor(child.state);
        const ca = child.assignedTo || 'Unassigned';
        push(`│   ${cc}■${RESET} #${child.id} — ${child.title}  [${cc}${stateLabel(child.state)}${RESET}]  ${ca}`);
      }
    }
    if (hiddenCount > 0) {
      push(`│   ${DIM}+ ${hiddenCount} completed${RESET}`);
    }

    push('└──────');
    push('');
  }

  for (const key of groupOrder) {
    const group = groups[key];
    if (group.stories.length === 0) continue;

    push(`${BOLD}${group.color}── ${group.icon} ${group.label} (${group.stories.length}) ──${RESET}`);
    push('');

    for (const story of group.stories) {
      renderStory(story);
    }
  }

  return lines;
}

/**
 * Handles the add-comment command.
 * Adds a comment (Discussion) to a work item using the Comments API.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdAddComment(cwd, args) {
  const idIdx = args.indexOf('--id');
  const textIdx = args.indexOf('--text');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const text = textIdx !== -1 ? args[textIdx + 1] : null;

  const missing = [];
  if (!id) missing.push('--id');
  if (!text) missing.push('--text');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs add-comment --id <workItemId> --text "<html>" [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const commentUrl = `${cfg.org}/${cfg.project}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`;
    const res = await makeRequest(commentUrl, encodedPat, 'POST', { text });

    if (res.status === 200 || res.status === 201) {
      const result = JSON.parse(res.body);
      console.log(JSON.stringify({ status: 'created', id: Number(id), commentId: result.id }));
      process.exit(0);
    } else {
      const errorBody = res.body ? JSON.parse(res.body) : {};
      throw new Error(`Failed to add comment to work item ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the delete-comment command.
 * Deletes a comment from a work item using the Comments API.
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdDeleteComment(cwd, args) {
  const idIdx = args.indexOf('--id');
  const commentIdx = args.indexOf('--comment-id');
  const id = idIdx !== -1 ? args[idIdx + 1] : null;
  const commentId = commentIdx !== -1 ? args[commentIdx + 1] : null;

  const missing = [];
  if (!id) missing.push('--id');
  if (!commentId) missing.push('--comment-id');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs delete-comment --id <workItemId> --comment-id <commentId> [--cwd <path>]');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const deleteUrl = `${cfg.org}/${cfg.project}/_apis/wit/workItems/${id}/comments/${commentId}?api-version=7.1-preview.4`;
    const res = await makeRequest(deleteUrl, encodedPat, 'DELETE');

    if (res.status === 200 || res.status === 204) {
      console.log(JSON.stringify({ status: 'deleted', id: Number(id), commentId: Number(commentId) }));
      process.exit(0);
    } else {
      const errorBody = res.body ? (function() { try { return JSON.parse(res.body); } catch(e) { return {}; } })() : {};
      throw new Error(`Failed to delete comment ${commentId} from work item ${id}: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the show-sprint command.
 * Fetches sprint metadata and items from Azure DevOps, then renders
 * a colored terminal board. Single command — no intermediate JSON passing needed.
 *
 * Usage: devsprint-tools.cjs show-sprint [--me] [--cwd <path>]
 *
 * stdout: ANSI-colored sprint board
 * Exit 0 on success, exit 1 on error.
 *
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args (supports --me)
 */
async function cmdShowSprint(cwd, args) {
  const mine = args && args.includes('--me');
  const showAll = args && args.includes('--all');
  const detailed = args && args.includes('--detailed');

  try {
    const { cfg, encodedPat, teamName, iteration } = await getSprintData(cwd);

    // Build sprint metadata
    const sprint = {
      name: iteration.name,
      path: iteration.path,
      startDate: iteration.attributes ? iteration.attributes.startDate : null,
      finishDate: iteration.attributes ? iteration.attributes.finishDate : null,
    };

    // Fetch work item IDs
    const workItemsUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations/${iteration.id}/workitems?api-version=7.1`;
    const wiRes = await makeRequest(workItemsUrl, encodedPat);
    if (wiRes.status !== 200) {
      throw new Error(`Failed to fetch sprint work items: HTTP ${wiRes.status}`);
    }

    const wiData = JSON.parse(wiRes.body);
    const idSet = new Set();
    for (const rel of (wiData.workItemRelations || [])) {
      if (rel.target) idSet.add(rel.target.id);
      if (rel.source) idSet.add(rel.source.id);
    }
    const ids = Array.from(idSet);

    if (ids.length === 0) {
      const lines = renderSprintBoard(sprint, [], { detailed });
      process.stdout.write(lines.join('\n') + '\n');
      process.exit(0);
    }

    let batchIds = ids;
    if (ids.length > 200) {
      console.error(`Warning: Sprint has ${ids.length} work items, showing first 200.`);
      batchIds = ids.slice(0, 200);
    }

    // Batch fetch details
    const batchUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitemsbatch?api-version=7.1`;
    const batchBody = {
      ids: batchIds,
      fields: [
        'System.Id', 'System.Title', 'System.WorkItemType',
        'System.State', 'System.Description',
        'Microsoft.VSTS.Common.AcceptanceCriteria',
        'System.Parent', 'System.AssignedTo',
        'System.Tags',
      ],
      errorPolicy: 'omit',
    };
    const batchRes = await makeRequest(batchUrl, encodedPat, 'POST', batchBody);
    if (batchRes.status !== 200) {
      throw new Error(`Failed to batch fetch work item details: HTTP ${batchRes.status}`);
    }

    const batchData = JSON.parse(batchRes.body);
    let items = (batchData.value || []).map((item) => {
      const assignedTo = item.fields['System.AssignedTo'];
      return {
        id: item.id,
        type: item.fields['System.WorkItemType'],
        title: item.fields['System.Title'],
        state: item.fields['System.State'],
        description: stripHtml(item.fields['System.Description'] || ''),
        acceptanceCriteria: stripHtml(item.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || ''),
        parentId: item.fields['System.Parent'] || null,
        assignedTo: assignedTo ? assignedTo.displayName : null,
        tags: item.fields['System.Tags'] ? item.fields['System.Tags'].split('; ') : [],
      };
    });

    // Filter to current user if --me
    if (mine) {
      const currentUser = await getAuthenticatedUser(cfg.org, encodedPat);
      const myItemIds = new Set(items.filter(i => i.assignedTo === currentUser).map(i => i.id));
      const myParentIds = new Set(items.filter(i => myItemIds.has(i.id) && i.parentId).map(i => i.parentId));
      const myChildIds = new Set(items.filter(i => myItemIds.has(i.parentId)).map(i => i.id));
      const allMyIds = new Set([...myItemIds, ...myParentIds, ...myChildIds]);
      items = items.filter(i => allMyIds.has(i.id));
    }

    // Unless --all, filter out completed stories (Resolved/Closed/Done)
    // Keep incomplete stories + their children, and orphan tasks that aren't done
    if (!showAll) {
      const doneStates = new Set(['Resolved', 'Closed', 'Done']);
      // Find story IDs that are completed
      const doneStoryIds = new Set(
        items.filter(i => (i.type === 'User Story' || i.type === 'Feature') && doneStates.has(i.state)).map(i => i.id)
      );
      // Keep items where: story is not done, OR item is a child of a non-done story, OR item has no parent
      items = items.filter(i => {
        // If it's a story/feature: keep only if not done
        if (i.type === 'User Story' || i.type === 'Feature') {
          return !doneStates.has(i.state);
        }
        // If it's a child (task/bug): keep only if parent is not done
        if (i.parentId) {
          return !doneStoryIds.has(i.parentId);
        }
        // Orphan items: keep if not done
        return !doneStates.has(i.state);
      });
    }

    const lines = renderSprintBoard(sprint, items, { detailed });
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// ─── Git / PR Helpers ───────────────────────────────────────────────────────────

/**
 * Runs a shell command synchronously in a given directory.
 * Returns { ok: true, stdout } on success or { ok: false, error } on failure.
 * @param {string} cmd - Shell command to execute
 * @param {string} cwd - Working directory
 * @returns {{ok: boolean, stdout?: string, error?: string}}
 */
function run(cmd, cwd) {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').trim() };
  }
}

/**
 * Slugifies a story title for use in a branch name.
 * Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim, max 60 chars.
 * @param {string} title
 * @returns {string}
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Handles the create-branch command.
 * Creates a feature branch from a base branch (default: develop, fallback: main).
 *
 * Usage: devsprint-tools.cjs create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]
 *
 * Steps:
 *   1. Stash uncommitted changes (if any)
 *   2. Fetch the base branch from origin (tries develop, falls back to main)
 *   3. Create and checkout feature/<storyId>-<slug> from origin/<base>
 *   4. If branch already exists, just checkout
 *
 * stdout: JSON {"branch":"feature/12345-add-user-reg","base":"develop","created":true|false}
 * Exit 0 on success, exit 1 on error.
 *
 * @param {string} cwd - Working directory (unused, repo path comes from --repo)
 * @param {string[]} args - CLI args
 */
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

    // Step 2: Determine base branch — try preferred, fall back to main
    let baseBranch = preferredBase;
    const fetchBase = run(`git fetch origin ${baseBranch}`, repoPath);
    if (!fetchBase.ok) {
      // Try main as fallback
      baseBranch = preferredBase === 'main' ? 'develop' : 'main';
      const fetchFallback = run(`git fetch origin ${baseBranch}`, repoPath);
      if (!fetchFallback.ok) {
        console.error(`Could not fetch base branch. Tried '${preferredBase}' and '${baseBranch}'. Error: ${fetchFallback.error}`);
        process.exit(1);
      }
    }

    // Step 3: Check if branch already exists locally or remotely
    const branchExists = run(`git rev-parse --verify ${branchName}`, repoPath);
    if (branchExists.ok) {
      // Check if the remote branch was already merged (deleted on remote after merge)
      const remoteCheck = run(`git ls-remote --heads origin ${branchName}`, repoPath);
      const remoteExists = remoteCheck.ok && remoteCheck.stdout.trim().length > 0;

      if (!remoteExists) {
        // Remote branch gone (merged & deleted) — create fresh branch with v2 suffix
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

      // Branch exists locally and remotely — just checkout
      const checkout = run(`git checkout ${branchName}`, repoPath);
      if (!checkout.ok) {
        console.error(`Failed to checkout existing branch ${branchName}: ${checkout.error}`);
        process.exit(1);
      }
      console.log(JSON.stringify({ branch: branchName, base: baseBranch, created: false }));
      process.exit(0);
    }

    // Step 4: Create new branch from origin/<base>
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

/**
 * Handles the create-pr command.
 * Pushes the current branch and creates a PR in Azure DevOps, linked to the story.
 *
 * Usage: devsprint-tools.cjs create-pr --repo <path> --branch <name> --base <branch>
 *          --title <title> --body <body> --story-id <id> --cwd <path>
 *
 * Steps:
 *   1. Push the branch to origin with -u
 *   2. Create a PR via Azure DevOps REST API (linked to story via workItemRefs)
 *
 * stdout: JSON {"pr":"https://...","prId":N,"branch":"...","base":"..."}
 * Exit 0 on success, exit 1 on error.
 *
 * @param {string} cwd - Working directory for loading Azure DevOps config
 * @param {string[]} args - CLI args
 */
async function cmdCreatePr(cwd, args) {
  const repoIdx = args.indexOf('--repo');
  const branchIdx = args.indexOf('--branch');
  const baseIdx = args.indexOf('--base');
  const titleIdx = args.indexOf('--title');
  const bodyIdx = args.indexOf('--body');
  const storyIdx = args.indexOf('--story-id');

  const repo = repoIdx !== -1 ? args[repoIdx + 1] : null;
  const branch = branchIdx !== -1 ? args[branchIdx + 1] : null;
  const base = baseIdx !== -1 ? args[baseIdx + 1] : 'develop';
  const title = titleIdx !== -1 ? args[titleIdx + 1] : null;
  const body = bodyIdx !== -1 ? args[bodyIdx + 1] : '';
  const storyId = storyIdx !== -1 ? args[storyIdx + 1] : null;

  const missing = [];
  if (!repo) missing.push('--repo');
  if (!branch) missing.push('--branch');
  if (!title) missing.push('--title');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id> --cwd <path>');
    process.exit(1);
  }

  const repoPath = path.resolve(repo);

  try {
    // Step 1: Push branch to origin
    const push = run(`git push -u origin ${branch}`, repoPath);
    if (!push.ok) {
      console.error(`Failed to push branch ${branch}: ${push.error}`);
      process.exit(1);
    }

    // Step 2: Create PR via Azure DevOps REST API
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // Resolve repo name from git remote URL
    const remoteUrl = run('git remote get-url origin', repoPath);
    if (!remoteUrl.ok) {
      console.error('Could not determine remote URL for repository');
      process.exit(1);
    }
    const repoName = remoteUrl.stdout.split('/').pop().replace('.git', '');

    // Check for existing PR on this branch
    const existingPrUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests?searchCriteria.sourceRefName=refs/heads/${encodeURIComponent(branch)}&searchCriteria.targetRefName=refs/heads/${encodeURIComponent(base)}&api-version=7.1`;
    const existingRes = await makeRequest(existingPrUrl, encodedPat);
    if (existingRes.status === 200) {
      const existingData = JSON.parse(existingRes.body);
      const existing = (existingData.value || []);
      const merged = existing.find(p => p.status === 'completed');
      if (merged) {
        const webUrl = `${cfg.org}/${cfg.project}/_git/${encodeURIComponent(repoName)}/pullRequest/${merged.pullRequestId}`;
        console.error(`PR already merged: #${merged.pullRequestId}`);
        console.log(JSON.stringify({ pr: webUrl, prId: merged.pullRequestId, branch, base, pushed: true, linked: !!storyId, alreadyMerged: true }));
        process.exit(0);
      }
      const active = existing.find(p => p.status === 'active');
      if (active) {
        const webUrl = `${cfg.org}/${cfg.project}/_git/${encodeURIComponent(repoName)}/pullRequest/${active.pullRequestId}`;
        console.error(`PR already exists: #${active.pullRequestId}`);
        console.log(JSON.stringify({ pr: webUrl, prId: active.pullRequestId, branch, base, pushed: true, linked: !!storyId, alreadyExists: true }));
        process.exit(0);
      }
    }

    // Build PR request body
    const prBody = {
      sourceRefName: `refs/heads/${branch}`,
      targetRefName: `refs/heads/${base}`,
      title: title,
      description: body || '',
    };

    // Link to story if story-id provided
    if (storyId) {
      prBody.workItemRefs = [{ id: storyId }];
    }

    const prUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests?api-version=7.1`;
    const prRes = await makeRequest(prUrl, encodedPat, 'POST', prBody);

    if (prRes.status === 201 || prRes.status === 200) {
      const prData = JSON.parse(prRes.body);
      const webUrl = `${cfg.org}/${cfg.project}/_git/${encodeURIComponent(repoName)}/pullRequest/${prData.pullRequestId}`;
      console.log(JSON.stringify({
        pr: webUrl,
        prId: prData.pullRequestId,
        branch,
        base,
        pushed: true,
        linked: !!storyId
      }));
      process.exit(0);
    } else {
      const errBody = prRes.body ? JSON.parse(prRes.body) : {};
      console.error(`Branch pushed but PR creation failed: HTTP ${prRes.status} — ${errBody.message || prRes.body}`);
      console.log(JSON.stringify({ pr: null, branch, base, pushed: true, error: errBody.message || `HTTP ${prRes.status}` }));
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the find-pr command.
 * Searches all repos for a PR whose title starts with "#{storyId}".
 * Prefers active PRs over completed ones. Returns the most recent match.
 *
 * Usage: devsprint-tools.cjs find-pr --story-id <id> --cwd <path>
 *
 * stdout: JSON {prId, title, description, status, sourceBranch, targetBranch, createdBy, repoName, url, workItemIds}
 * Exit 0 on success, exit 1 if no PR found.
 */
async function cmdFindPr(cwd, args) {
  const storyIdIdx = args.indexOf('--story-id');
  const storyId = storyIdIdx !== -1 ? args[storyIdIdx + 1] : null;

  if (!storyId) {
    console.error('Missing required argument: --story-id <id>');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // List all repos
    const reposUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories?api-version=7.1`;
    const reposRes = await makeRequest(reposUrl, encodedPat);
    if (reposRes.status !== 200) {
      console.error(`Failed to list repos: HTTP ${reposRes.status}`);
      process.exit(1);
    }
    const repos = JSON.parse(reposRes.body).value || [];

    let bestMatch = null;

    for (const repo of repos) {
      if (repo.isDisabled) continue;

      // Search for PRs in this repo (both active and completed)
      const searchUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repo.name)}/pullrequests?api-version=7.1&searchCriteria.status=all&$top=50`;
      const searchRes = await makeRequest(searchUrl, encodedPat);
      if (searchRes.status !== 200) continue;

      const prs = JSON.parse(searchRes.body).value || [];
      for (const pr of prs) {
        // Match title starting with #{storyId}
        if (pr.title && pr.title.startsWith(`#${storyId}`)) {
          const candidate = {
            prId: pr.pullRequestId,
            title: pr.title,
            description: pr.description || '',
            status: pr.status,
            sourceBranch: (pr.sourceRefName || '').replace('refs/heads/', ''),
            targetBranch: (pr.targetRefName || '').replace('refs/heads/', ''),
            createdBy: pr.createdBy?.displayName || '',
            repoName: repo.name,
          };

          // Prefer active over completed
          if (!bestMatch || (candidate.status === 'active' && bestMatch.status !== 'active')) {
            bestMatch = candidate;
          }
        }
      }
    }

    if (!bestMatch) {
      console.error(`No PR found for story #${storyId}. PR title should start with "#${storyId}".`);
      process.exit(1);
    }

    // Fetch work item links for the found PR
    const wiUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(bestMatch.repoName)}/pullrequests/${bestMatch.prId}/workitems?api-version=7.1`;
    const wiRes = await makeRequest(wiUrl, encodedPat);
    let workItemIds = [];
    if (wiRes.status === 200) {
      const wiData = JSON.parse(wiRes.body);
      workItemIds = (wiData.value || []).map(wi => parseInt(wi.id));
    }

    const webUrl = `${cfg.org}/${cfg.project}/_git/${encodeURIComponent(bestMatch.repoName)}/pullRequest/${bestMatch.prId}`;
    bestMatch.url = webUrl;
    bestMatch.workItemIds = workItemIds;

    console.log(JSON.stringify(bestMatch));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the get-pr command.
 * Fetches a pull request by ID. If --repo-name is given, looks in that repo directly.
 * If --repo-name is omitted, searches across all repos in the project.
 *
 * Usage: devsprint-tools.cjs get-pr --pr-id <id> [--repo-name <name>] --cwd <path>
 *
 * stdout: JSON {prId, title, description, status, sourceBranch, targetBranch, createdBy, repoName, url, workItemIds}
 * Exit 0 on success, exit 1 on error.
 */
async function cmdGetPr(cwd, args) {
  const repoNameIdx = args.indexOf('--repo-name');
  const prIdIdx = args.indexOf('--pr-id');

  let repoName = repoNameIdx !== -1 ? args[repoNameIdx + 1] : null;
  const prId = prIdIdx !== -1 ? args[prIdIdx + 1] : null;

  if (!prId) {
    console.error('Missing required argument: --pr-id <id>');
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // If no repo name given, search across all repos
    if (!repoName) {
      const reposUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories?api-version=7.1`;
      const reposRes = await makeRequest(reposUrl, encodedPat);
      if (reposRes.status !== 200) {
        console.error(`Failed to list repos: HTTP ${reposRes.status}`);
        process.exit(1);
      }
      const repos = JSON.parse(reposRes.body).value || [];

      for (const repo of repos) {
        if (repo.isDisabled) continue;
        const tryUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repo.name)}/pullrequests/${prId}?api-version=7.1`;
        const tryRes = await makeRequest(tryUrl, encodedPat);
        if (tryRes.status === 200) {
          repoName = repo.name;
          break;
        }
      }

      if (!repoName) {
        console.error(`PR #${prId} not found in any repository in the project.`);
        process.exit(1);
      }
    }

    const url = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}?api-version=7.1`;
    const res = await makeRequest(url, encodedPat);

    if (res.status !== 200) {
      console.error(`Failed to fetch PR #${prId} from ${repoName}: HTTP ${res.status}`);
      process.exit(1);
    }

    const pr = JSON.parse(res.body);

    // Fetch linked work items
    const wiUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}/workitems?api-version=7.1`;
    const wiRes = await makeRequest(wiUrl, encodedPat);
    let workItemIds = [];
    if (wiRes.status === 200) {
      const wiData = JSON.parse(wiRes.body);
      workItemIds = (wiData.value || []).map(wi => parseInt(wi.id));
    }

    const webUrl = `${cfg.org}/${cfg.project}/_git/${encodeURIComponent(repoName)}/pullRequest/${pr.pullRequestId}`;

    console.log(JSON.stringify({
      prId: pr.pullRequestId,
      title: pr.title,
      description: pr.description || '',
      status: pr.status,
      sourceBranch: (pr.sourceRefName || '').replace('refs/heads/', ''),
      targetBranch: (pr.targetRefName || '').replace('refs/heads/', ''),
      createdBy: pr.createdBy?.displayName || '',
      repoName: pr.repository?.name || repoName,
      url: webUrl,
      workItemIds
    }));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the get-pr-threads command.
 * Fetches all comment threads on a pull request, including review comments with file/line context.
 *
 * Usage: devsprint-tools.cjs get-pr-threads --pr-id <id> [--repo-name <name>] [--active-only] --cwd <path>
 *
 * If --repo-name is omitted, the repo is auto-detected by searching for the PR across all repos.
 *
 * stdout: JSON array [{threadId, status, comments: [{author, content, publishedDate}], filePath, lineNumber, repoName}]
 *   status: "active" | "fixed" | "closed" | "byDesign" | "pending" | "wontFix" | "unknown"
 *   filePath/lineNumber: only present for file-level comments
 *   repoName: always included (useful when auto-detected)
 * Exit 0 on success, exit 1 on error.
 */
async function cmdGetPrThreads(cwd, args) {
  const repoNameIdx = args.indexOf('--repo-name');
  const prIdIdx = args.indexOf('--pr-id');
  const activeOnly = args.includes('--active-only');    // legacy alias
  const unresolvedOnly = args.includes('--unresolved') || activeOnly;

  let repoName = repoNameIdx !== -1 ? args[repoNameIdx + 1] : null;
  const prId = prIdIdx !== -1 ? args[prIdIdx + 1] : null;

  if (!prId) {
    console.error('Missing required argument: --pr-id <id>');
    process.exit(1);
  }

  // If no repo name, auto-detect by finding the PR
  if (!repoName) {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');
    const reposUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories?api-version=7.1`;
    const reposRes = await makeRequest(reposUrl, encodedPat);
    if (reposRes.status !== 200) {
      console.error(`Failed to list repos: HTTP ${reposRes.status}`);
      process.exit(1);
    }
    const repos = JSON.parse(reposRes.body).value || [];
    for (const repo of repos) {
      if (repo.isDisabled) continue;
      const tryUrl = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repo.name)}/pullrequests/${prId}?api-version=7.1`;
      const tryRes = await makeRequest(tryUrl, encodedPat);
      if (tryRes.status === 200) {
        repoName = repo.name;
        break;
      }
    }
    if (!repoName) {
      console.error(`PR #${prId} not found in any repository in the project.`);
      process.exit(1);
    }
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const url = `${cfg.org}/${cfg.project}/_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests/${prId}/threads?api-version=7.1`;
    const res = await makeRequest(url, encodedPat);

    if (res.status !== 200) {
      console.error(`Failed to fetch PR threads: HTTP ${res.status}`);
      process.exit(1);
    }

    const data = JSON.parse(res.body);
    const statusMap = { 0: 'unknown', 1: 'active', 2: 'fixed', 3: 'wontFix', 4: 'closed', 5: 'byDesign', 6: 'pending' };

    let threads = (data.value || [])
      .filter(t => !t.isDeleted)
      .filter(t => {
        // Skip system threads (auto-generated by Azure DevOps)
        const firstComment = t.comments?.[0];
        if (firstComment && firstComment.commentType === 'system') return false;
        return true;
      })
      .map(t => {
        const status = statusMap[t.status] || 'unknown';
        const comments = (t.comments || [])
          .filter(c => !c.isDeleted && c.commentType !== 'system')
          .map(c => ({
            author: c.author?.displayName || '',
            content: c.content || '',
            publishedDate: c.publishedDate || ''
          }));

        const result = {
          threadId: t.id,
          status,
          comments
        };

        // Add file context if present
        if (t.threadContext?.filePath) {
          result.filePath = t.threadContext.filePath;
          if (t.threadContext.rightFileStart) {
            result.lineNumber = t.threadContext.rightFileStart.line;
          }
        }

        return result;
      });

    if (unresolvedOnly) {
      threads = threads.filter(t => t.status === 'active' || t.status === 'pending' || t.status === 'unknown');
    }

    // Filter out empty threads (no user comments)
    threads = threads.filter(t => t.comments.length > 0);

    // Include repoName in output (useful when auto-detected)
    const output = { repoName, threads };
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

/**
 * Handles the list-repos command.
 * Fetches Git repositories from the Azure DevOps project, sorted by most recent push.
 *
 * Usage: devsprint-tools.cjs list-repos [--top <N>] --cwd <path>
 *
 * stdout: JSON array [{name, id, remoteUrl, lastPushDate}]
 * Exit 0 on success, exit 1 on error.
 *
 * @param {string} cwd - Working directory for loading Azure DevOps config
 * @param {string[]} args - CLI args
 */
/**
 * Handles the create-work-item command.
 * Creates a new work item (User Story or Task) in Azure DevOps.
 * Optionally assigns to current sprint and links to a parent work item.
 *
 * Required args: --type <type> --title <title>
 * Optional args: --description <html>, --parent <id>, --sprint (assign to current sprint),
 *                --assigned-to <name>, --area <path>, --tags <comma-separated>
 *
 * stdout: JSON {"status":"created","id":N,"type":"...","title":"...","url":"..."}
 * Exit 0 on success, exit 1 on error.
 *
 * @param {string} cwd - Working directory
 * @param {string[]} args - CLI args after the command name
 */
async function cmdCreateWorkItem(cwd, args) {
  const typeIdx = args.indexOf('--type');
  const titleIdx = args.indexOf('--title');
  const descIdx = args.indexOf('--description');
  const parentIdx = args.indexOf('--parent');
  const assignedIdx = args.indexOf('--assigned-to');
  const areaIdx = args.indexOf('--area');
  const tagsIdx = args.indexOf('--tags');
  const useSprint = args.includes('--sprint');

  const type = typeIdx !== -1 ? args[typeIdx + 1] : null;
  const title = titleIdx !== -1 ? args[titleIdx + 1] : null;
  const description = descIdx !== -1 ? args[descIdx + 1] : null;
  const parentId = parentIdx !== -1 ? args[parentIdx + 1] : null;
  const assignedTo = assignedIdx !== -1 ? args[assignedIdx + 1] : null;
  const areaArg = areaIdx !== -1 ? args[areaIdx + 1] : null;
  const tags = tagsIdx !== -1 ? args[tagsIdx + 1] : null;

  const missing = [];
  if (!type) missing.push('--type');
  if (!title) missing.push('--title');

  if (missing.length > 0) {
    console.error(`Missing required arguments: ${missing.join(', ')}`);
    console.error('Usage: devsprint-tools.cjs create-work-item --type <"User Story"|"Task"|"Bug"> --title "<title>" [--description "<html>"] [--parent <id>] [--sprint] [--assigned-to "<name>"] [--area "<path>"] [--tags "<comma-separated>"]');
    process.exit(1);
  }

  // Validate type
  const validTypes = ['User Story', 'Task', 'Bug', 'Feature', 'Epic'];
  if (!validTypes.includes(type)) {
    console.error(`Invalid work item type: "${type}". Valid types: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    // Build JSON Patch body
    const patchBody = [
      { op: 'add', path: '/fields/System.Title', value: title },
    ];

    if (description) {
      patchBody.push({ op: 'add', path: '/fields/System.Description', value: description });
    }

    if (assignedTo) {
      patchBody.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo });
    }

    // Use explicit --area arg, or fall back to config area
    const area = areaArg || cfg.area;
    if (area) {
      patchBody.push({ op: 'add', path: '/fields/System.AreaPath', value: area });
    }

    if (tags) {
      patchBody.push({ op: 'add', path: '/fields/System.Tags', value: tags });
    }

    // Assign to current sprint if requested
    if (useSprint) {
      const teamName = cfg.team || await resolveTeamName(cfg.org, cfg.project, encodedPat);
      const iterationsUrl = `${cfg.org}/${cfg.project}/${encodeURIComponent(teamName)}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1`;
      const iterRes = await makeRequest(iterationsUrl, encodedPat);
      if (iterRes.status === 200) {
        const iterData = JSON.parse(iterRes.body);
        if (iterData.value && iterData.value.length > 0) {
          patchBody.push({ op: 'add', path: '/fields/System.IterationPath', value: iterData.value[0].path });
        }
      }
    }

    // Set parent work item via System.Parent field (not relations — relations don't persist reliably)
    if (parentId) {
      patchBody.push({ op: 'add', path: '/fields/System.Parent', value: Number(parentId) });
    }

    // Create work item via POST with json-patch+json
    const encodedType = encodeURIComponent(type);
    const createUrl = `${cfg.org}/${cfg.project}/_apis/wit/workitems/$${encodedType}?api-version=7.1`;
    const res = await makePatchRequest(createUrl, encodedPat, patchBody);

    if (res.status === 200) {
      const created = JSON.parse(res.body);
      const webUrl = created._links && created._links.html ? created._links.html.href : '';
      console.log(JSON.stringify({
        status: 'created',
        id: created.id,
        type: type,
        title: title,
        url: webUrl,
      }));
      process.exit(0);
    } else {
      const errorBody = res.body ? JSON.parse(res.body) : {};
      throw new Error(`Failed to create work item: HTTP ${res.status} — ${errorBody.message || res.body}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

async function cmdListRepos(cwd, args) {
  const topIdx = args.indexOf('--top');
  const top = topIdx !== -1 ? parseInt(args[topIdx + 1], 10) : 20;

  try {
    const cfg = loadConfig(cwd);
    const encodedPat = Buffer.from(':' + cfg.pat).toString('base64');

    const url = `${cfg.org}/${cfg.project}/_apis/git/repositories?api-version=7.1`;
    const res = await makeRequest(url, encodedPat);

    if (res.status !== 200) {
      console.error(`Failed to fetch repositories: HTTP ${res.status}`);
      process.exit(1);
    }

    const data = JSON.parse(res.body);
    const repos = (data.value || [])
      .filter(r => !r.isDisabled)
      .map(r => ({
        name: r.name,
        id: r.id,
        remoteUrl: r.remoteUrl,
        lastPushDate: r.project && r.project.lastUpdateTime ? r.project.lastUpdateTime : null,
      }))
      .sort((a, b) => {
        // Sort by name for consistency (API doesn't guarantee lastPushDate on all repos)
        return a.name.localeCompare(b.name);
      })
      .slice(0, top);

    console.log(JSON.stringify(repos));
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

// ─── CLI Router ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Extract --cwd flag (default to process.cwd())
  let cwd = process.cwd();
  const cwdEqArg = args.find(arg => arg.startsWith('--cwd='));
  const cwdIdx = args.indexOf('--cwd');

  if (cwdEqArg) {
    const value = cwdEqArg.slice('--cwd='.length).trim();
    if (!value) {
      console.error('Missing value for --cwd');
      process.exit(1);
    }
    args.splice(args.indexOf(cwdEqArg), 1);
    cwd = path.resolve(value);
  } else if (cwdIdx !== -1) {
    const value = args[cwdIdx + 1];
    if (!value || value.startsWith('--')) {
      console.error('Missing value for --cwd');
      process.exit(1);
    }
    args.splice(cwdIdx, 2);
    cwd = path.resolve(value);
  }

  const command = args[0];

  if (!command) {
    console.error('Usage: azdo-tools.cjs <command> [options] [--cwd <path>]');
    console.error('');
    console.error('Commands:');
    console.error('  save-config  --org <org> --project <project> --pat <pat>');
    console.error('               Save Azure DevOps credentials to .planning/devsprint-config.json');
    console.error('');
    console.error('  load-config  Read and decode credentials from .planning/devsprint-config.json');
    console.error('');
    console.error('  test         Test connection to Azure DevOps API');
    console.error('');
    console.error('  get-sprint   Fetch the current active sprint iteration');
    console.error('               stdout: JSON {iterationId, name, path, startDate, finishDate}');
    console.error('');
    console.error('  get-sprint-items [--me]');
    console.error('               Fetch all work items in the current sprint with full details');
    console.error('               stdout: JSON array [{id, type, title, state, description, acceptanceCriteria, parentId}]');
    console.error('               --me: filter to items assigned to the authenticated user');
    console.error('');
    console.error('  get-branch-links --id <workItemId>');
    console.error('               Resolve branch artifact links from a work item to repository details');
    console.error('               stdout: JSON array [{repositoryId, repositoryName, remoteUrl, branchName}]');
    console.error('               Returns [] if no branch link found. Requires PAT scopes: vso.work + vso.code');
    console.error('');
    console.error('  update-description --id <workItemId> --description "<text>"');
    console.error('               Update the Description field of a work item');
    console.error('               stdout: JSON {status, id}');
    console.error('');
    console.error('  update-acceptance-criteria --id <workItemId> --criteria "<html>"');
    console.error('               Update the Acceptance Criteria field of a work item');
    console.error('               stdout: JSON {status, id}');
    console.error('');
    console.error('  update-state --id <workItemId> --state <state>');
    console.error('               Change the System.State field of a work item');
    console.error('               stdout: JSON {status, id, state}');
    console.error('');
    console.error('  get-child-states --id <storyId>');
    console.error('               Fetch all child task states for a parent story');
    console.error('               stdout: JSON {allResolved: bool, children: [{id, title, state}]}');
    console.error('');
    console.error('  create-branch --repo <path> --story-id <id> --title <title> [--base <branch>]');
    console.error('               Create a feature branch from develop (fallback: main)');
    console.error('               Stashes dirty changes, fetches base, creates feature/<id>-<slug>');
    console.error('               stdout: JSON {branch, base, created: bool}');
    console.error('');
    console.error('  create-pr --repo <path> --branch <name> --base <branch> --title <title> --body <body> --story-id <id>');
    console.error('               Push branch and create a PR via Azure DevOps REST API');
    console.error('               Links PR to story when --story-id is provided');
    console.error('               stdout: JSON {pr: "<url>", prId: N, branch, base, pushed: bool, linked: bool}');
    console.error('');
    console.error('');
    console.error('  find-pr --story-id <id>');
    console.error('               Find a PR by story ID (searches all repos for title starting with "#<id>")');
    console.error('               Prefers active PRs over completed ones');
    console.error('               stdout: JSON {prId, title, status, sourceBranch, targetBranch, repoName, url, workItemIds}');
    console.error('');
    console.error('  get-pr --pr-id <id> [--repo-name <name>]');
    console.error('               Fetch pull request details (title, branches, status, linked work items)');
    console.error('               If --repo-name omitted, searches all repos');
    console.error('               stdout: JSON {prId, title, description, status, sourceBranch, targetBranch, ...}');
    console.error('');
    console.error('  get-pr-threads --repo-name <name> --pr-id <id> [--active-only]');
    console.error('               Fetch comment threads on a PR (review comments with file/line context)');
    console.error('               --active-only: only return threads with status "active"');
    console.error('               stdout: JSON array [{threadId, status, comments, filePath, lineNumber}]');
    console.error('');
    console.error('  show-sprint [--me]');
    console.error('               Fetch sprint data and render colored board to stdout');
    console.error('               --me: filter to items assigned to the authenticated user');
    console.error('');
    console.error('  list-repos [--top <N>]');
    console.error('               List Git repositories in the Azure DevOps project');
    console.error('               stdout: JSON array [{name, id, remoteUrl, lastPushDate}]');
    console.error('               --top: limit results (default: 20)');
    console.error('');
    console.error('  add-comment --id <workItemId> --text "<html>"');
    console.error('               Add a comment (Discussion) to a work item');
    console.error('               Text accepts HTML for rich formatting');
    console.error('               stdout: JSON {status, id, commentId}');
    console.error('');
    console.error('  delete-comment --id <workItemId> --comment-id <commentId>');
    console.error('               Delete a comment from a work item');
    console.error('               stdout: JSON {status, id, commentId}');
    console.error('');
    console.error('  create-work-item --type <type> --title <title> [--description "<html>"] [--parent <id>] [--sprint] [--assigned-to "<name>"] [--area "<path>"] [--tags "<comma-separated>"]');
    console.error('               Create a new work item (User Story, Task, Bug, Feature, Epic)');
    console.error('               --sprint: assign to current sprint, --parent: link as child');
    console.error('               stdout: JSON {status, id, type, title, url}');
    process.exit(1);
  }

  const cmdArgs = args.slice(1);

  switch (command) {
    case 'save-config':
      await cmdSaveConfig(cwd, cmdArgs);
      break;

    case 'load-config':
      await cmdLoadConfig(cwd);
      break;

    case 'test':
      await cmdTest(cwd);
      break;

    case 'get-sprint':
      await cmdGetSprint(cwd);
      break;

    case 'get-sprint-items':
      await cmdGetSprintItems(cwd, cmdArgs);
      break;

    case 'get-work-item':
      await cmdGetWorkItem(cwd, cmdArgs);
      break;

    case 'get-branch-links':
      await cmdGetBranchLinks(cwd, cmdArgs);
      break;

    case 'update-description':
      await cmdUpdateDescription(cwd, cmdArgs);
      break;

    case 'update-acceptance-criteria':
      await cmdUpdateAcceptanceCriteria(cwd, cmdArgs);
      break;

    case 'update-state':
      await cmdUpdateState(cwd, cmdArgs);
      break;

    case 'get-child-states':
      await cmdGetChildStates(cwd, cmdArgs);
      break;

    case 'create-branch':
      await cmdCreateBranch(cwd, cmdArgs);
      break;

    case 'create-pr':
      await cmdCreatePr(cwd, cmdArgs);
      break;

    case 'find-pr':
      await cmdFindPr(cwd, cmdArgs);
      break;

    case 'get-pr':
      await cmdGetPr(cwd, cmdArgs);
      break;

    case 'get-pr-threads':
      await cmdGetPrThreads(cwd, cmdArgs);
      break;

    case 'show-sprint':
      await cmdShowSprint(cwd, cmdArgs);
      break;

    case 'list-repos':
      await cmdListRepos(cwd, cmdArgs);
      break;

    case 'add-comment':
      await cmdAddComment(cwd, cmdArgs);
      break;

    case 'delete-comment':
      await cmdDeleteComment(cwd, cmdArgs);
      break;

    case 'create-work-item':
      await cmdCreateWorkItem(cwd, cmdArgs);
      break;

    case 'list-teams':
      await cmdListTeams(cwd);
      break;

    case 'get-team-area':
      await cmdGetTeamArea(cwd, cmdArgs);
      break;

    case 'report-status':
      cmdReportStatus(cwd, cmdArgs);
      break;

    case 'clear-status':
      cmdClearStatus(cwd);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available commands: save-config, load-config, test, get-sprint, get-sprint-items, get-work-item, get-branch-links, update-description, update-acceptance-criteria, update-state, get-child-states, create-branch, create-pr, find-pr, get-pr, get-pr-threads, show-sprint, list-repos, add-comment, delete-comment, create-work-item, list-teams, get-team-area');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
