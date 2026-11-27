'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PLAYBOOK = path.join(__dirname, '..', 'playbooks', 'small-business-review.json');

function loadPlaybook(file = DEFAULT_PLAYBOOK) {
  const playbook = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ids = (playbook.stages || []).map((stage) => stage.id);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('A playbook needs stages with unique ids');
  for (const option of playbook.catalogue || []) {
    if (!option.id || !Number.isFinite(Number(option.level)) || !Array.isArray(option.capabilities)) throw new Error(`Invalid catalogue option: ${option.id || '(no id)'}`);
  }
  return playbook;
}

module.exports = { loadPlaybook, DEFAULT_PLAYBOOK };
