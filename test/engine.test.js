'use strict';

// Graph, question planner and matcher tests are adapted from the original
// engine's suite; gate tests are rewritten for playbook-driven stages.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('../src');

const NOW = '2026-08-15T01:00:00.000Z';
const playbook = os.loadPlaybook();
const catalogue = playbook.catalogue;

function fresh() {
  return os.createGraph({ engagementId: 'eng-test', stages: playbook.stages.map((s) => s.id), now: NOW });
}

function withEvidence(graph, type = 'client', overrides = {}) {
  return os.addEvidence(graph, {
    type,
    sourceId: overrides.sourceId || `${type}-source`,
    excerpt: overrides.excerpt || 'The owner confirmed this during the session.',
    locator: overrides.locator || 'session:1',
    publisher: overrides.publisher,
    jurisdiction: overrides.jurisdiction,
    publishedAt: overrides.publishedAt,
    reliability: overrides.reliability || 'high',
    now: NOW,
  });
}

function addFact(graph, conceptId, value = conceptId, overrides = {}) {
  const evidence = withEvidence(graph, overrides.evidenceType || 'client', { sourceId: `src-${conceptId}`, ...(overrides.evidence || {}) });
  return os.recordFact(evidence.graph, {
    conceptId, value, stage: overrides.stage || conceptId.split('.')[0],
    state: overrides.state || 'client_confirmed', evidenceIds: [evidence.evidenceId], now: NOW,
  }).graph;
}

function approve(graph, stage, kind = 'stage_confirmation', choice = 'confirmed') {
  const evidence = withEvidence(graph, 'client', { sourceId: `approval-${stage}-${kind}`, excerpt: 'Owner approved in writing.' });
  return os.recordDecision(evidence.graph, { stage, kind, choice, humanApproved: true, evidenceIds: [evidence.evidenceId], now: NOW }).graph;
}

test('graph separates evidence, facts and hypotheses', () => {
  let graph = fresh();
  const evidence = withEvidence(graph);
  graph = os.proposeHypothesis(evidence.graph, {
    conceptId: 'diagnosis.cause', value: 'Handoff delay', stage: 'diagnosis', kind: 'cause',
    supportingEvidenceIds: [evidence.evidenceId], confidence: 0.6, now: NOW,
  }).graph;
  assert.equal(Object.keys(graph.facts).length, 0);
  assert.equal(Object.keys(graph.hypotheses).length, 1);
  assert.equal(Object.values(graph.hypotheses)[0].status, 'supported');
});

test('a hypothesis can never overwrite a client-confirmed fact', () => {
  let graph = addFact(fresh(), 'intake.goal', 'Cut quote turnaround to two days');
  graph = os.proposeHypothesis(graph, { conceptId: 'intake.goal', value: 'Grow revenue 50%', stage: 'intake', now: NOW }).graph;
  assert.equal(graph.facts['intake.goal'].value, 'Cut quote turnaround to two days');
  assert.equal(Object.values(graph.hypotheses)[0].status, 'rejected');
});

test('a fact without traceable evidence is refused', () => {
  assert.throws(() => os.recordFact(fresh(), { conceptId: 'intake.goal', value: 'x', stage: 'intake', now: NOW }), /evidenceId/);
});

test('changing a confirmed fact requires an explicit supersession', () => {
  let graph = addFact(fresh(), 'intake.constraint', 'Budget under $5k');
  assert.throws(() => os.recordFact(graph, {
    conceptId: 'intake.constraint', value: 'Budget under $10k', stage: 'intake',
    evidenceIds: graph.facts['intake.constraint'].evidenceIds, now: NOW,
  }), /supersedesFactId/);
  const priorId = graph.facts['intake.constraint'].id;
  const correction = withEvidence(graph, 'client', { sourceId: 'session-2', excerpt: 'Owner raised the budget.' });
  graph = os.recordFact(correction.graph, {
    conceptId: 'intake.constraint', value: 'Budget under $10k', stage: 'intake',
    supersedesFactId: priorId, reason: 'Owner raised the budget', evidenceIds: [correction.evidenceId], now: NOW,
  }).graph;
  assert.equal(graph.facts['intake.constraint'].version, 2);
  assert.ok(graph.history.some((row) => row.type === 'fact_superseded'));
});

test('stages come from the playbook and unknown stages are refused', () => {
  assert.deepEqual(fresh().stages, ['intake', 'diagnosis', 'options', 'decision']);
  const evidence = withEvidence(fresh());
  assert.throws(() => os.recordFact(evidence.graph, { conceptId: 'x', value: 'y', stage: 'not_a_stage', evidenceIds: [evidence.evidenceId], now: NOW }), /Unknown stage/);
  assert.throws(() => os.createGraph({ stages: [] }), /At least one stage/);
});

test('question planner refuses to re-ask a known concept across stages', () => {
  const graph = addFact(fresh(), 'intake.goal', 'Faster quotes');
  assert.deepEqual(os.assessQuestion(graph, {
    stage: 'diagnosis', conceptId: 'intake.goal', question: 'What is your goal?', expectedDecisionImpact: 'Sets the target.',
  }), { allowed: false, reason: 'already_known' });
});

test('question planner reopens a known concept only for a valid contradiction', () => {
  let graph = addFact(fresh(), 'diagnosis.problem', 'Quotes are slow');
  const evidence = withEvidence(graph, 'document', { sourceId: 'quote-log', excerpt: 'Quotes are sent same day; deposits arrive late.' });
  graph = os.proposeHypothesis(evidence.graph, {
    conceptId: 'diagnosis.problem', value: 'Deposits are slow', stage: 'diagnosis', kind: 'problem',
    contradictingEvidenceIds: [evidence.evidenceId], now: NOW,
  }).graph;
  const hypothesisId = Object.keys(graph.hypotheses)[0];
  const result = os.assessQuestion(graph, {
    stage: 'diagnosis', conceptId: 'diagnosis.problem', question: 'Your log shows same-day quotes. Is the delay in deposits instead?',
    expectedDecisionImpact: 'Resolves which problem we work on.', reopenReason: 'contradiction', contradictionIds: [hypothesisId],
  });
  assert.equal(result.reason, 'reopen:contradiction');
});

test('question planner records one material question and blocks a repeat', () => {
  const first = os.recordQuestion(fresh(), {
    stage: 'intake', conceptId: 'intake.constraint', question: 'What budget is available?', expectedDecisionImpact: 'Limits the options.', now: NOW,
  });
  assert.equal(first.allowed, true);
  const second = os.assessQuestion(first.graph, {
    stage: 'diagnosis', conceptId: 'intake.constraint', question: 'How much budget do you have?', expectedDecisionImpact: 'Same limit.',
  });
  assert.deepEqual([second.allowed, second.reason], [false, 'already_asked']);
});

test('intake gate holds review, then needs facts and a human approval to advance', () => {
  let graph = fresh();
  assert.equal(os.assessStage(graph, 'intake', playbook).reviewReady, false);
  for (const id of ['intake.goal', 'intake.decision_owner', 'intake.constraint']) graph = addFact(graph, id, `value for ${id}`);
  let gate = os.assessStage(graph, 'intake', playbook);
  assert.deepEqual([gate.reviewReady, gate.canAdvance, gate.advanceBlockers], [true, false, ['human_approval_missing']]);
  gate = os.assessStage(approve(graph, 'intake'), 'intake', playbook);
  assert.equal(gate.canAdvance, true);
});

test('hypotheses can make a stage review-ready but never advance it', () => {
  let graph = fresh();
  for (const id of ['intake.goal', 'intake.decision_owner', 'intake.constraint']) {
    const ev = withEvidence(graph, 'client', { sourceId: `h-${id}` });
    graph = os.proposeHypothesis(ev.graph, { conceptId: id, value: 'guess', stage: 'intake', supportingEvidenceIds: [ev.evidenceId], now: NOW }).graph;
  }
  const gate = os.assessStage(approve(graph, 'intake'), 'intake', playbook);
  assert.equal(gate.reviewReady, true);
  assert.equal(gate.canAdvance, false);
  assert.equal(gate.missingForAdvance.length, 3);
});

function diagnosisBase() {
  let graph = fresh();
  graph = addFact(graph, 'diagnosis.problem', 'Quotes take five days');
  graph = addFact(graph, 'diagnosis.impact', 'Two of five leads go elsewhere');
  graph = addFact(graph, 'diagnosis.baseline_unmeasured', 'No quote timestamps kept yet');
  return graph;
}

function cause(graph, value, evidence = true) {
  const ev = withEvidence(graph, 'document', { sourceId: `cause-${value}`, excerpt: `Notes support: ${value}` });
  return os.proposeHypothesis(ev.graph, {
    conceptId: `diagnosis.cause.${value}`, value, stage: 'diagnosis', kind: 'cause',
    supportingEvidenceIds: evidence ? [ev.evidenceId] : [], now: NOW,
  }).graph;
}

test('diagnosis refuses a single unsupported cause', () => {
  const gate = os.assessStage(cause(diagnosisBase(), 'owner_busy', false), 'diagnosis', playbook, { now: NOW });
  assert.ok(gate.reviewBlockers.includes('competing_hypotheses_missing'));
  assert.ok(gate.reviewBlockers.includes('hypothesis_without_evidence'));
});

test('diagnosis passes with two evidenced causes, an explicit baseline and approval', () => {
  const graph = approve(cause(cause(diagnosisBase(), 'owner_busy'), 'pricing_unclear'), 'diagnosis');
  const gate = os.assessStage(graph, 'diagnosis', playbook, { now: NOW });
  assert.equal(gate.canAdvance, true, gate.rationale);
});

test('market evidence needs provenance and must be current', () => {
  const graph = approve(cause(cause(diagnosisBase(), 'owner_busy'), 'pricing_unclear'), 'diagnosis');
  const bare = withEvidence(graph, 'market', { sourceId: 'blog', excerpt: 'Customers expect quotes in 24h.' }).graph;
  assert.ok(os.assessStage(bare, 'diagnosis', playbook, { now: NOW }).reviewBlockers.includes('market_provenance_incomplete'));
  const old = withEvidence(graph, 'market', { sourceId: 'survey-2020', excerpt: 'Quote expectations survey.', publisher: 'Trade body', jurisdiction: 'AU', publishedAt: '2020-01-01T00:00:00Z' }).graph;
  assert.ok(os.assessStage(old, 'diagnosis', playbook, { now: NOW }).reviewBlockers.includes('market_evidence_stale'));
});

test('options gate needs a traceable comparison and an approved choice matching the recommendation', () => {
  let graph = fresh();
  for (const id of ['options.capability_needed', 'options.who_decides', 'options.fallback']) graph = addFact(graph, id, `value for ${id}`);
  assert.ok(os.assessStage(graph, 'options', playbook).reviewBlockers.includes('options_comparison_missing'));
  const match = os.matchSolutions({ desiredCapabilities: ['workflow'], processStable: false, evidenceStrength: 'developing' }, catalogue);
  graph = os.addArtifact(graph, { type: 'options_comparison', stage: 'options', title: 'Options', claimIds: [graph.facts['options.capability_needed'].id], payload: match, now: NOW }).graph;
  const wrong = approve(graph, 'options', 'option_selection', 'automated_workflow');
  assert.ok(os.assessStage(wrong, 'options', playbook).advanceBlockers.includes('selection_mismatch'));
  const right = approve(graph, 'options', 'option_selection', match.recommended.id);
  assert.equal(os.assessStage(right, 'options', playbook).canAdvance, true);
});

test('matcher rejects an assistant when data, authority, review and fallback are absent', () => {
  const result = os.matchSolutions({
    desiredCapabilities: ['recommendation'], evidenceStrength: 'supported', dataReady: false, processStable: true,
    integrationReadiness: true, authorityDefined: false, humanReview: false, fallbackDefined: false,
  }, catalogue);
  const assistant = result.ineligible.find((row) => row.id === 'assistant_with_review');
  for (const reason of ['dependable_data_missing', 'decision_authority_missing', 'human_review_missing', 'fallback_missing']) assert.ok(assistant.rejectedReasons.includes(reason));
});

test('matcher chooses automation only when every prerequisite and the capability fit pass', () => {
  const result = os.matchSolutions({
    desiredCapabilities: ['multi_step', 'routing', 'monitoring'], evidenceStrength: 'supported', dataReady: true,
    processStable: true, integrationReadiness: true, authorityDefined: true, humanReview: true, fallbackDefined: true,
  }, catalogue);
  assert.equal(result.recommended.id, 'automated_workflow');
  assert.equal(result.requiresHumanApproval, true);
});

test('matcher prefers the lighter option when two eligible options solve the same need', () => {
  const result = os.matchSolutions({ desiredCapabilities: ['routing'], evidenceStrength: 'supported' }, [
    { id: 'l1', type: 'software', label: 'L1', level: 1, capabilities: ['routing'], prerequisites: {} },
    { id: 'l3', type: 'automation', label: 'L3', level: 3, capabilities: ['routing'], prerequisites: {} },
  ]);
  assert.equal(result.recommended.id, 'l1');
});

test('matcher never recommends an unrelated option and needs a catalogue', () => {
  const result = os.matchSolutions({
    desiredCapabilities: ['unknown_capability'], evidenceStrength: 'supported', dataReady: true, processStable: true,
    integrationReadiness: true, authorityDefined: true, humanReview: true, fallbackDefined: true,
  }, catalogue);
  assert.equal(result.recommended.id, 'measure_first');
  assert.throws(() => os.matchSolutions({}), /catalogue is required/);
});

test('artifacts cannot cite claims that do not exist', () => {
  assert.throws(() => os.addArtifact(fresh(), { type: 'options_comparison', stage: 'options', title: 'x', claimIds: ['fact_missing'], now: NOW }), /Unknown artifact claims/);
});

test('stage assessments persist without mutating the source graph', () => {
  const graph = fresh();
  const next = os.recordStageAssessment(graph, os.assessStage(graph, 'intake', playbook), NOW);
  assert.equal(graph.stageAssessments.intake, undefined);
  assert.equal(next.stageAssessments.intake.canAdvance, false);
});
