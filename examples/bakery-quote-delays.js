'use strict';

// A fictional engagement with a two-person bakery whose catering quotes are slow.
// Walks intake and diagnosis through their gates, then compares options. Run: npm run demo
const os = require('../src');

const playbook = os.loadPlaybook();
let graph = os.createGraph({ engagementId: 'demo-bakery', stages: playbook.stages.map((s) => s.id) });

function evidence(type, sourceId, excerpt, extra = {}) {
  const r = os.addEvidence(graph, { type, sourceId, excerpt, reliability: 'high', ...extra });
  graph = r.graph;
  return r.evidenceId;
}
function fact(conceptId, value, ev) { graph = os.recordFact(graph, { conceptId, value, stage: conceptId.split('.')[0], evidenceIds: [ev] }).graph; }
function gate(stage) {
  const g = os.assessStage(graph, stage, playbook);
  graph = os.recordStageAssessment(graph, g);
  console.log(`  gate ${stage.padEnd(9)} ${g.status.padEnd(12)} ${g.rationale}`);
  return g;
}
function approve(stage, kind = 'stage_confirmation', choice = 'confirmed') {
  const ev = evidence('client', `email-${stage}-${kind}`, `Owner replied "approved" to the ${stage} summary.`);
  graph = os.recordDecision(graph, { stage, kind, choice, humanApproved: true, evidenceIds: [ev] }).graph;
}

console.log('Intake');
const call = evidence('client', 'call-1', 'Owner: we lose catering jobs because quotes take most of a week.');
fact('intake.goal', 'Send catering quotes within two working days', call);
fact('intake.decision_owner', 'Owner (Ana)', call);
gate('intake');
fact('intake.constraint', 'No new monthly software over $50', call);
gate('intake');
approve('intake');
gate('intake');

console.log('\nDiagnosis');
const ask = os.recordQuestion(graph, { stage: 'diagnosis', conceptId: 'intake.goal', question: 'What are you trying to achieve?', expectedDecisionImpact: 'Sets the target' });
console.log(`  planner: re-asking the goal → ${ask.reason}`);
const inbox = evidence('document', 'inbox-export', 'Last 10 catering enquiries: median 5 days from enquiry to quote.');
fact('diagnosis.problem', 'Catering quotes take a median of 5 days', inbox);
fact('diagnosis.impact', '4 of the last 10 enquiries booked elsewhere', inbox);
fact('diagnosis.baseline', 'Median 5 days from enquiry to quote', inbox);
graph = os.proposeHypothesis(graph, { conceptId: 'diagnosis.cause.pricing', value: 'Each quote is priced from scratch', stage: 'diagnosis', kind: 'cause', supportingEvidenceIds: [inbox] }).graph;
gate('diagnosis');
const notes = evidence('client', 'call-2', 'Owner only answers email after the Saturday market.');
graph = os.proposeHypothesis(graph, { conceptId: 'diagnosis.cause.time', value: 'Enquiries wait for the weekly admin slot', stage: 'diagnosis', kind: 'cause', supportingEvidenceIds: [notes] }).graph;
approve('diagnosis');
gate('diagnosis');

console.log('\nOptions');
const match = os.matchSolutions({ desiredCapabilities: ['standardisation', 'drafting'], evidenceStrength: 'supported', processStable: false, dataReady: false }, playbook.catalogue);
for (const row of match.eligible) console.log(`  ✓ ${row.label}`);
for (const row of match.ineligible) console.log(`  ✗ ${row.label} — ${row.rejectedReasons.join(', ')}`);
console.log(`  ${match.rationale}. A person still decides.`);
