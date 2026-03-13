/**
 * GitHub Integration Verification Test
 *
 * Validates that the devsprint-config.json is correctly configured
 * for GitHub provider and that all required fields are present.
 *
 * Run: node tests/github-integration.test.cjs
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '.planning', 'devsprint-config.json');
const MCP_PATH = path.join(__dirname, '..', '.mcp.json');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

console.log('GitHub Integration Tests\n');

// Test 1: Config file exists
console.log('[Config file]');
const configExists = fs.existsSync(CONFIG_PATH);
assert(configExists, 'devsprint-config.json exists');

if (configExists) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // Test 2: Provider is set to github
  console.log('\n[Provider configuration]');
  assert(config.provider === 'github', `Provider is "github" (got "${config.provider}")`);

  // Test 3: GitHub section exists with required fields
  console.log('\n[GitHub settings]');
  assert(config.github != null, 'GitHub config section exists');
  assert(typeof config.github?.owner === 'string' && config.github.owner.length > 0, `Owner is set ("${config.github?.owner}")`);
  assert(typeof config.github?.repo === 'string' && config.github.repo.length > 0, `Repo is set ("${config.github?.repo}")`);
  assert(typeof config.github?.assignee === 'string' && config.github.assignee.length > 0, `Assignee is set ("${config.github?.assignee}")`);
}

// Test 4: MCP config — check repo root or Claude plugins cache
console.log('\n[MCP configuration]');
const mcpCandidates = [
  MCP_PATH,
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'plugins', 'cache', 'claude-plugins-official', 'github'),
];
let mcpFound = false;
for (const candidate of mcpCandidates) {
  if (fs.existsSync(candidate)) {
    mcpFound = true;
    break;
  }
}
assert(mcpFound, 'GitHub MCP server is available (repo .mcp.json or Claude plugin)');

// Test 5: Key command files exist
console.log('\n[Command files]');
const commandDir = path.join(__dirname, '..', 'commands');
const requiredCommands = ['devsprint-plan.md', 'devsprint-execute.md', 'devsprint-sprint.md', 'devsprint-setup.md'];
for (const cmd of requiredCommands) {
  assert(fs.existsSync(path.join(commandDir, cmd)), `${cmd} exists`);
}

// Summary
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
