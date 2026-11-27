'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('CLI records an engagement and passes the intake gate only after approval', () => {
  const env = { ...process.env, CONSULTANTOS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'consultant-os-')) };
  const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'consultantos.js'), ...args], { env, encoding: 'utf8' }).trim();
  assert.match(cli('new', 'acme'), /intake → diagnosis → options → decision/);
  const ev = cli('evidence', 'acme', '--type', 'client', '--source', 'call-1', '--excerpt', 'Owner wants faster quotes.', '--reliability', 'high');
  for (const concept of ['intake.goal', 'intake.decision_owner', 'intake.constraint']) cli('fact', 'acme', concept, `value ${concept}`, '--evidence', ev);
  assert.match(cli('gate', 'acme', 'intake'), /human_approval_missing/);
  assert.throws(() => cli('ask', 'acme', 'intake.goal', 'What is your goal?', '--stage', 'diagnosis', '--impact', 'target'), (e) => /already_known/.test(e.stdout));
  cli('approve', 'acme', 'intake', 'stage_confirmation', 'confirmed', '--evidence', ev);
  assert.match(cli('gate', 'acme', 'intake'), /intake: confirmed/);
  assert.match(cli('options', 'acme', '--need', 'standardisation'), /fix_the_process/);
  assert.throws(() => cli('fact', 'acme', 'intake.goal', 'something else', '--evidence', ev), (e) => /supersedesFactId/.test(e.stderr));
  assert.throws(() => cli('show', '../escape'), (e) => /Engagement names/.test(e.stderr));
});
