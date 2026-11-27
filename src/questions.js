'use strict';

/** Cross-stage no-repeat planner. The model may phrase a question; the server
 * decides whether that concept may be asked at all. */

const { assertGraph } = require('./graph');

const REOPEN_REASONS = new Set(['client_changed', 'contradiction', 'stale_evidence']);

function clean(value, max = 600) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fingerprint(question) {
  return clean(question, 1000).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|is|are|what|which|how|do|does|your|you|cua|la|gi|nao|nhu|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

function currentLedger(graph, conceptId) {
  return graph.questions[conceptId] || { conceptId, askedCount: 0, answered: false, declined: false, fingerprints: [] };
}

function assessQuestion(graph, input = {}) {
  assertGraph(graph);
  const conceptId = clean(input.conceptId, 160);
  const stage = graph.stages.includes(input.stage) ? input.stage : null;
  const question = clean(input.question, 600);
  const impact = clean(input.expectedDecisionImpact, 500);
  if (!conceptId || !stage || !question || !impact) {
    return { allowed: false, reason: 'incomplete_question_contract' };
  }
  const ledger = currentLedger(graph, conceptId);
  const fact = graph.facts[conceptId];
  const reopenReason = clean(input.reopenReason, 80);
  const contradictionIds = (input.contradictionIds || []).filter((id) => graph.hypotheses[id]?.status === 'contested');
  const validReopen = REOPEN_REASONS.has(reopenReason)
    && (reopenReason !== 'contradiction' || contradictionIds.length > 0);
  if (ledger.declined && !validReopen) return { allowed: false, reason: 'concept_declined' };
  if ((fact || ledger.answered) && !validReopen) return { allowed: false, reason: 'already_known' };
  if (ledger.askedCount > 0 && !validReopen) return { allowed: false, reason: 'already_asked' };
  const fp = fingerprint(question);
  const duplicate = Object.values(graph.questions).some((row) => (row.fingerprints || []).includes(fp));
  if (duplicate && !validReopen) return { allowed: false, reason: 'semantic_duplicate' };
  return { allowed: true, reason: validReopen ? `reopen:${reopenReason}` : 'new_material_question', fingerprint: fp };
}

function recordQuestion(previous, input = {}) {
  const verdict = assessQuestion(previous, input);
  if (!verdict.allowed) return { graph: previous, ...verdict };
  const graph = clone(previous);
  const conceptId = clean(input.conceptId, 160);
  const prior = currentLedger(graph, conceptId);
  graph.questions[conceptId] = {
    ...prior,
    stage: input.stage,
    askedCount: Number(prior.askedCount || 0) + 1,
    lastQuestion: clean(input.question, 600),
    expectedDecisionImpact: clean(input.expectedDecisionImpact, 500),
    fingerprints: [...new Set([...(prior.fingerprints || []), verdict.fingerprint])],
    reopenReason: verdict.reason.startsWith('reopen:') ? verdict.reason.slice(7) : null,
    contradictionIds: (input.contradictionIds || []).slice(0, 20),
    lastAskedAt: new Date(input.now || Date.now()).toISOString(),
  };
  graph.history.push({ type: 'question_asked', conceptId, stage: input.stage, at: graph.questions[conceptId].lastAskedAt });
  graph.updatedAt = graph.questions[conceptId].lastAskedAt;
  return { graph, ...verdict };
}

function resolveQuestion(previous, conceptId, input = {}) {
  assertGraph(previous);
  const graph = clone(previous);
  const key = clean(conceptId, 160);
  const prior = currentLedger(graph, key);
  graph.questions[key] = {
    ...prior,
    answered: input.answered === true,
    declined: input.declined === true,
    answeredByClaimIds: [...new Set([...(prior.answeredByClaimIds || []), ...(input.claimIds || [])])],
    resolvedAt: new Date(input.now || Date.now()).toISOString(),
  };
  graph.updatedAt = graph.questions[key].resolvedAt;
  return graph;
}

module.exports = { REOPEN_REASONS, fingerprint, assessQuestion, recordQuestion, resolveQuestion };
