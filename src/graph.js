'use strict';

/**
 * Engagement graph
 *
 * Stage-neutral truth layer for a consulting engagement. Client facts,
 * working hypotheses and evidence live in separate collections so an
 * inference can never silently become client truth.
 */

const crypto = require('crypto');

const VERSION = 1;
const FORMAT = 'consultant-os/graph';
const FACT_STATES = new Set(['client_confirmed', 'document_supported', 'observed']);
const HYPOTHESIS_STATES = new Set(['open', 'supported', 'contested', 'rejected', 'confirmed']);
const EVIDENCE_TYPES = new Set(['client', 'document', 'system', 'market', 'expert']);
const DEFAULT_STAGES = Object.freeze(['intake', 'diagnosis', 'options', 'decision']);

function clean(value, max = 800) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function at(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  return date.toISOString();
}

function idFor(prefix, parts) {
  const digest = crypto.createHash('sha256').update(parts.map((part) => clean(part, 2000)).join('\u001f')).digest('hex').slice(0, 18);
  return `${prefix}_${digest}`;
}

function assertGraph(graph) {
  if (!graph || graph.format !== FORMAT || graph.version !== VERSION) throw new Error(`${FORMAT} v${VERSION} required`);
}

function stageOf(graph, value, fallback) {
  if (graph.stages.includes(value)) return value;
  if (value) throw new Error(`Unknown stage: ${value}`);
  return fallback === 'last' ? graph.stages[graph.stages.length - 1] : graph.stages[0];
}

function createGraph({ engagementId = '', language = 'en', market = '', stages = DEFAULT_STAGES, now } = {}) {
  const stamp = at(now);
  const stageList = [...new Set((stages || []).map((stage) => clean(stage, 60)).filter(Boolean))];
  if (!stageList.length) throw new Error('At least one stage is required');
  return {
    format: FORMAT,
    version: VERSION,
    engagementId: clean(engagementId, 160),
    stages: stageList,
    context: { language: clean(language, 16) || 'en', market: clean(market, 16) },
    facts: {},
    hypotheses: {},
    evidence: {},
    questions: {},
    decisions: {},
    artifacts: {},
    stageAssessments: {},
    history: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function addHistory(graph, event, now) {
  graph.history.push({ ...event, at: at(now) });
  graph.history = graph.history.slice(-500);
  graph.updatedAt = at(now);
}

function addEvidence(previous, input = {}) {
  assertGraph(previous);
  if (!EVIDENCE_TYPES.has(input.type)) throw new Error(`Unsupported evidence type: ${input.type || 'missing'}`);
  const sourceId = clean(input.sourceId, 240);
  const excerpt = clean(input.excerpt, 1600);
  if (!sourceId) throw new Error('Evidence sourceId is required');
  if (!excerpt && input.type !== 'system') throw new Error('Evidence excerpt is required');
  const graph = clone(previous);
  const evidenceId = clean(input.id, 120) || idFor('ev', [input.type, sourceId, input.locator, excerpt]);
  const publishedAt = input.publishedAt ? at(input.publishedAt) : null;
  const observedAt = at(input.observedAt || input.now);
  graph.evidence[evidenceId] = {
    id: evidenceId,
    type: input.type,
    sourceId,
    label: clean(input.label, 240),
    excerpt,
    locator: clean(input.locator, 300),
    publisher: clean(input.publisher, 200),
    jurisdiction: clean(input.jurisdiction, 40),
    publishedAt,
    validUntil: input.validUntil ? at(input.validUntil) : null,
    observedAt,
    permission: clean(input.permission, 80) || 'consultation',
    reliability: ['low', 'medium', 'high'].includes(input.reliability) ? input.reliability : 'medium',
  };
  addHistory(graph, { type: 'evidence_added', evidenceId }, input.now);
  return { graph, evidenceId };
}

function validEvidenceIds(graph, ids) {
  const unique = [...new Set((ids || []).map((id) => clean(id, 120)).filter(Boolean))];
  const missing = unique.filter((id) => !graph.evidence[id]);
  if (missing.length) throw new Error(`Unknown evidence: ${missing.join(', ')}`);
  return unique;
}

function factId(conceptId) {
  return idFor('fact', [conceptId]);
}

function recordFact(previous, input = {}) {
  assertGraph(previous);
  const conceptId = clean(input.conceptId, 160);
  const value = clean(input.value, 1600);
  const state = FACT_STATES.has(input.state) ? input.state : 'client_confirmed';
  const stage = stageOf(previous, input.stage, 'first');
  if (!conceptId || !value) throw new Error('Fact conceptId and value are required');
  const graph = clone(previous);
  const evidenceIds = validEvidenceIds(graph, input.evidenceIds);
  if (!evidenceIds.length) throw new Error('Every fact requires at least one evidenceId');
  const prior = graph.facts[conceptId];
  if (prior && prior.value !== value && input.supersedesFactId !== prior.id) {
    throw new Error(`Fact ${conceptId} already exists; explicit supersedesFactId is required`);
  }
  if (prior && prior.value === value) {
    prior.evidenceIds = [...new Set([...(prior.evidenceIds || []), ...evidenceIds])];
    prior.updatedAt = at(input.now);
    graph.updatedAt = prior.updatedAt;
    return { graph, factId: prior.id, unchanged: true };
  }
  const id = factId(conceptId);
  if (prior) {
    addHistory(graph, { type: 'fact_superseded', conceptId, factId: prior.id, value: prior.value, reason: clean(input.reason, 400) }, input.now);
  }
  graph.facts[conceptId] = {
    id,
    conceptId,
    value,
    state,
    stage,
    evidenceIds,
    notApplicable: input.notApplicable === true,
    rationale: clean(input.rationale, 600),
    version: Number(prior?.version || 0) + 1,
    updatedAt: at(input.now),
  };
  for (const hypothesis of Object.values(graph.hypotheses)) {
    if (hypothesis.conceptId !== conceptId || ['rejected', 'confirmed'].includes(hypothesis.status)) continue;
    hypothesis.status = hypothesis.value === value ? 'confirmed' : 'rejected';
    hypothesis.resolvedByFactId = id;
    hypothesis.updatedAt = at(input.now);
  }
  addHistory(graph, { type: prior ? 'fact_replaced' : 'fact_recorded', conceptId, factId: id }, input.now);
  return { graph, factId: id, unchanged: false };
}

function proposeHypothesis(previous, input = {}) {
  assertGraph(previous);
  const conceptId = clean(input.conceptId, 160);
  const value = clean(input.value, 1600);
  const stage = stageOf(previous, input.stage, 'first');
  if (!conceptId || !value) throw new Error('Hypothesis conceptId and value are required');
  const graph = clone(previous);
  const supportingEvidenceIds = validEvidenceIds(graph, input.supportingEvidenceIds);
  const contradictingEvidenceIds = validEvidenceIds(graph, input.contradictingEvidenceIds);
  const id = clean(input.id, 120) || idFor('hyp', [conceptId, value]);
  const existingFact = graph.facts[conceptId];
  const status = existingFact
    ? (existingFact.value === value ? 'confirmed' : ((supportingEvidenceIds.length || contradictingEvidenceIds.length) ? 'contested' : 'rejected'))
    : (contradictingEvidenceIds.length ? 'contested' : supportingEvidenceIds.length ? 'supported' : 'open');
  graph.hypotheses[id] = {
    id,
    conceptId,
    value,
    stage,
    kind: clean(input.kind, 80) || 'working',
    status,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    supportingEvidenceIds,
    contradictingEvidenceIds,
    rationale: clean(input.rationale, 800),
    resolvedByFactId: existingFact?.id || null,
    version: Number(graph.hypotheses[id]?.version || 0) + 1,
    updatedAt: at(input.now),
  };
  addHistory(graph, { type: 'hypothesis_recorded', hypothesisId: id, conceptId, status }, input.now);
  return { graph, hypothesisId: id };
}

function reviewHypothesis(previous, hypothesisId, input = {}) {
  assertGraph(previous);
  if (!HYPOTHESIS_STATES.has(input.status)) throw new Error(`Unsupported hypothesis status: ${input.status || 'missing'}`);
  const graph = clone(previous);
  const hypothesis = graph.hypotheses[hypothesisId];
  if (!hypothesis) throw new Error(`Unknown hypothesis: ${hypothesisId}`);
  hypothesis.supportingEvidenceIds = [...new Set([...(hypothesis.supportingEvidenceIds || []), ...validEvidenceIds(graph, input.supportingEvidenceIds)])];
  hypothesis.contradictingEvidenceIds = [...new Set([...(hypothesis.contradictingEvidenceIds || []), ...validEvidenceIds(graph, input.contradictingEvidenceIds)])];
  hypothesis.status = input.status;
  hypothesis.rationale = clean(input.rationale, 800) || hypothesis.rationale;
  hypothesis.updatedAt = at(input.now);
  addHistory(graph, { type: 'hypothesis_reviewed', hypothesisId, status: input.status }, input.now);
  return graph;
}

function addArtifact(previous, input = {}) {
  assertGraph(previous);
  const type = clean(input.type, 80);
  const stage = stageOf(previous, input.stage, 'first');
  if (!type) throw new Error('Artifact type is required');
  const graph = clone(previous);
  const claimIds = [...new Set((input.claimIds || []).map((v) => clean(v, 120)).filter(Boolean))];
  const knownClaimIds = new Set([
    ...Object.values(graph.facts).map((row) => row.id),
    ...Object.values(graph.hypotheses).map((row) => row.id),
  ]);
  const unknownClaims = claimIds.filter((id) => !knownClaimIds.has(id));
  if (unknownClaims.length) throw new Error(`Unknown artifact claims: ${unknownClaims.join(', ')}`);
  const id = clean(input.id, 120) || idFor('art', [stage, type, input.title, JSON.stringify(input.payload || {})]);
  graph.artifacts[id] = {
    id, type, stage,
    title: clean(input.title, 240),
    status: ['draft', 'supported', 'confirmed'].includes(input.status) ? input.status : 'draft',
    sourceIds: validEvidenceIds(graph, input.sourceIds),
    claimIds,
    version: Number(graph.artifacts[id]?.version || 0) + 1,
    payload: clone(input.payload || {}),
    updatedAt: at(input.now),
  };
  addHistory(graph, { type: 'artifact_recorded', artifactId: id, stage }, input.now);
  return { graph, artifactId: id };
}

function recordDecision(previous, input = {}) {
  assertGraph(previous);
  const decisionId = clean(input.id, 120) || idFor('dec', [input.stage, input.kind, input.choice, input.now || Date.now()]);
  const graph = clone(previous);
  graph.decisions[decisionId] = {
    id: decisionId,
    stage: stageOf(previous, input.stage, 'last'),
    kind: clean(input.kind, 100),
    choice: clean(input.choice, 300),
    rationale: clean(input.rationale, 800),
    humanApproved: input.humanApproved === true,
    evidenceIds: validEvidenceIds(graph, input.evidenceIds),
    createdAt: at(input.now),
  };
  addHistory(graph, { type: 'decision_recorded', decisionId, humanApproved: input.humanApproved === true }, input.now);
  return { graph, decisionId };
}

function recordStageAssessment(previous, assessment, now) {
  assertGraph(previous);
  if (!assessment || !previous.stages.includes(assessment.stage)) throw new Error('Valid stage assessment required');
  const graph = clone(previous);
  graph.stageAssessments[assessment.stage] = { ...clone(assessment), recordedAt: at(now) };
  addHistory(graph, { type: 'stage_assessed', stage: assessment.stage, canAdvance: assessment.canAdvance === true }, now);
  return graph;
}

module.exports = {
  VERSION, FORMAT, DEFAULT_STAGES, FACT_STATES, HYPOTHESIS_STATES, EVIDENCE_TYPES,
  createGraph, addEvidence, recordFact, proposeHypothesis, reviewHypothesis,
  addArtifact, recordDecision, recordStageAssessment, assertGraph,
};
