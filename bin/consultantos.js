#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('../src');

const HELP = `ConsultantOS — an evidence-first record of a consulting engagement

Usage
  consultantos new <name> [--playbook file.json]
  consultantos evidence <name> --type client|document|system|market|expert --source ID --excerpt TEXT
                        [--reliability low|medium|high] [--publisher P --jurisdiction J --published DATE]
  consultantos fact <name> <concept> <value> --evidence ID[,ID] [--stage S] [--supersedes FACT_ID --reason TEXT]
  consultantos hypothesis <name> <concept> <value> [--kind K] [--stage S] [--supports IDs] [--contradicts IDs]
  consultantos ask <name> <concept> <question> --stage S --impact TEXT
  consultantos answered <name> <concept>
  consultantos gate <name> <stage>
  consultantos options <name> --need cap[,cap] [--yes dataReady,humanReview,...] [--strength developing]
                       [--save --stage S --claims FACT_ID[,FACT_ID]]
  consultantos approve <name> <stage> <kind> <choice> --evidence ID[,ID]
  consultantos show <name>

Engagements are saved in .consultant-os/<name>.json (or the folder in CONSULTANTOS_HOME).
Use fictional records.`;

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const name = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { args[name] = true; continue; }
    args[name] = value; i += 1;
  }
  return args;
}

const list = (value) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : []);
const home = () => process.env.CONSULTANTOS_HOME || path.join(process.cwd(), '.consultant-os');
const fileFor = (name) => {
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(name || '')) throw new Error('Engagement names use letters, numbers, dot, dash or underscore');
  return path.join(home(), `${name}.json`);
};

function load(name) {
  const file = fileFor(name);
  if (!fs.existsSync(file)) throw new Error(`No engagement named ${name}. Run consultantos new ${name}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...data, playbook: os.loadPlaybook(data.playbookFile) };
}

function save(name, data) {
  const file = fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ playbookFile: data.playbookFile, graph: data.graph }, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function printGate(gate) {
  console.log(`${gate.stage}: ${gate.status} · review ${gate.coverage.review.met}/${gate.coverage.review.total} · confirmed ${gate.coverage.confirmed.met}/${gate.coverage.confirmed.total} · evidence ${gate.evidence.grade}`);
  console.log(gate.rationale);
}

function main() {
  const args = parse(process.argv.slice(2));
  const [command, name, ...rest] = args._;
  if (!command || command === 'help' || args.help) return console.log(HELP);

  if (command === 'new') {
    const file = fileFor(name);
    if (fs.existsSync(file)) throw new Error(`Engagement ${name} already exists`);
    const playbookFile = path.resolve(typeof args.playbook === 'string' ? args.playbook : require('../src/playbook').DEFAULT_PLAYBOOK);
    const playbook = os.loadPlaybook(playbookFile);
    save(name, { playbookFile, graph: os.createGraph({ engagementId: name, stages: playbook.stages.map((s) => s.id) }) });
    return console.log(`Created ${name} with playbook "${playbook.title}": ${playbook.stages.map((s) => s.id).join(' → ')}`);
  }

  const data = load(name);
  let { graph } = data;
  const { playbook } = data;

  if (command === 'evidence') {
    const r = os.addEvidence(graph, { type: args.type, sourceId: args.source, excerpt: args.excerpt, locator: args.locator, reliability: args.reliability, publisher: args.publisher, jurisdiction: args.jurisdiction, publishedAt: args.published });
    graph = r.graph; console.log(r.evidenceId);
  } else if (command === 'fact') {
    const [concept, value] = rest;
    const r = os.recordFact(graph, { conceptId: concept, value, stage: args.stage || concept?.split('.')[0], evidenceIds: list(args.evidence), supersedesFactId: args.supersedes, reason: args.reason });
    graph = r.graph; console.log(`${r.factId}${r.unchanged ? ' (unchanged, evidence added)' : ''}`);
  } else if (command === 'hypothesis') {
    const [concept, value] = rest;
    const r = os.proposeHypothesis(graph, { conceptId: concept, value, kind: args.kind, stage: args.stage || concept?.split('.')[0], supportingEvidenceIds: list(args.supports), contradictingEvidenceIds: list(args.contradicts) });
    graph = r.graph; console.log(`${r.hypothesisId} ${graph.hypotheses[r.hypothesisId].status}`);
  } else if (command === 'ask') {
    const [concept, question] = rest;
    const r = os.recordQuestion(graph, { conceptId: concept, question, stage: args.stage, expectedDecisionImpact: args.impact, reopenReason: args.reopen, contradictionIds: list(args.contradictions) });
    graph = r.graph; console.log(r.allowed ? `Ask it (${r.reason})` : `Do not ask: ${r.reason}`);
    if (!r.allowed) process.exitCode = 2;
  } else if (command === 'answered') {
    graph = os.resolveQuestion(graph, rest[0], { answered: true }); console.log(`${rest[0]} answered`);
  } else if (command === 'gate') {
    const gate = os.assessStage(graph, rest[0], playbook);
    graph = os.recordStageAssessment(graph, gate); printGate(gate);
  } else if (command === 'options') {
    const context = { desiredCapabilities: list(args.need), evidenceStrength: args.strength || 'developing' };
    for (const flag of list(args.yes)) context[flag] = true;
    for (const flag of list(args.no)) context[flag] = false;
    const match = os.matchSolutions(context, playbook.catalogue);
    for (const row of match.eligible) console.log(`  ✓ ${row.id.padEnd(22)} level ${row.level} · score ${row.score}`);
    for (const row of match.ineligible) console.log(`  ✗ ${row.id.padEnd(22)} ${row.rejectedReasons.join(', ')}`);
    console.log(match.rationale);
    if (args.save) {
      const r = os.addArtifact(graph, { type: 'options_comparison', stage: args.stage, title: `Options for ${context.desiredCapabilities.join(', ')}`, claimIds: list(args.claims), payload: match });
      graph = r.graph; console.log(`Saved ${r.artifactId}`);
    }
  } else if (command === 'approve') {
    const [stage, kind, choice] = rest;
    const r = os.recordDecision(graph, { stage, kind, choice, humanApproved: true, evidenceIds: list(args.evidence), rationale: args.reason });
    graph = r.graph; console.log(r.decisionId);
  } else if (command === 'show') {
    console.log(`${graph.engagementId} · playbook "${playbook.title}"`);
    for (const f of Object.values(graph.facts)) console.log(`  fact  ${f.conceptId} = ${f.value} (${f.id})`);
    for (const h of Object.values(graph.hypotheses)) console.log(`  hyp   ${h.conceptId} ~ ${h.value} [${h.status}] (${h.id})`);
    console.log(`  ${Object.keys(graph.evidence).length} evidence · ${Object.keys(graph.decisions).length} decisions · ${Object.keys(graph.artifacts).length} artifacts`);
    return;
  } else {
    throw new Error(`Unknown command ${command}. Run consultantos help`);
  }
  save(name, { ...data, graph });
}

try { main(); } catch (error) { console.error(error.message); process.exit(1); }
