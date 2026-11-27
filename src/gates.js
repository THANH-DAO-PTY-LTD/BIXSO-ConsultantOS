'use strict';

/**
 * Stage gates driven by a playbook. A gate separates two decisions:
 * "ready for client review" (every required claim exists and is traceable)
 * and "can advance" (claims are client-confirmed facts and a human approved).
 * Adapted from a hard-coded stage assessment; every rule is now data.
 */

const { assertGraph } = require('./graph');

function evidenceSummary(graph, records) {
  const ids = [...new Set(records.flatMap((row) => row?.evidenceIds || row?.supportingEvidenceIds || []))];
  const sources = ids.map((id) => graph.evidence[id]).filter(Boolean);
  const contradicted = records.filter((row) => row?.status === 'contested' || (row?.contradictingEvidenceIds || []).length).length;
  const high = sources.filter((row) => row.reliability === 'high').length;
  const grade = contradicted ? 'contested' : sources.length >= 2 && high >= 1 ? 'supported' : sources.length ? 'developing' : 'insufficient';
  return { grade, sourceCount: sources.length, highReliabilitySources: high, contradicted };
}

function hypothesisFor(graph, conceptId) {
  return Object.values(graph.hypotheses)
    .filter((row) => row.conceptId === conceptId && row.status !== 'rejected')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
}

function claimFor(graph, conceptId) {
  return graph.facts[conceptId] || hypothesisFor(graph, conceptId);
}

function approvalFor(graph, stage, kind) {
  return Object.values(graph.decisions).some((row) => row.stage === stage
    && row.kind === kind && row.humanApproved && row.evidenceIds.length);
}

function ruleFor(playbook, stage) {
  const rule = (playbook?.stages || []).find((row) => row.id === stage);
  if (!rule) throw new Error(`The playbook has no gate for stage: ${stage}`);
  return rule;
}

function assessStage(graph, stage, playbook, options = {}) {
  assertGraph(graph);
  if (!graph.stages.includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  const rule = ruleFor(playbook, stage);
  const required = [...(rule.required || [])];
  const reviewClaims = required.map((conceptId) => claimFor(graph, conceptId)).filter(Boolean);
  const missingForReview = required.filter((conceptId) => !claimFor(graph, conceptId));
  const missingForAdvance = required.filter((conceptId) => !graph.facts[conceptId]);
  const unsupported = reviewClaims.filter((row) => !(row.evidenceIds || row.supportingEvidenceIds || []).length).map((row) => row.conceptId);
  const reviewBlockers = [];
  const advanceBlockers = [];

  for (const need of rule.artifacts || []) {
    const rows = Object.values(graph.artifacts).filter((row) => row.stage === stage && row.type === need.type);
    if (!rows.length) reviewBlockers.push(`${need.type}_missing`);
    else if (!rows.some((row) => (need.minClaims ? row.claimIds.length >= need.minClaims : (row.sourceIds.length || row.claimIds.length)))) reviewBlockers.push(`${need.type}_not_linked_to_claims`);
  }

  if (rule.baselineOneOf?.length) {
    const label = rule.baselineOneOf.join('_or_');
    const claim = rule.baselineOneOf.map((id) => claimFor(graph, id)).find(Boolean);
    if (!claim) missingForReview.push(label); else reviewClaims.push(claim);
    if (!rule.baselineOneOf.some((id) => graph.facts[id])) missingForAdvance.push(label);
  }

  if (rule.competingHypotheses) {
    const { kind, min = 2, waiverConcept } = rule.competingHypotheses;
    const rows = Object.values(graph.hypotheses).filter((row) => row.stage === stage && row.kind === kind && row.status !== 'rejected');
    if (rows.length < min && !(waiverConcept && claimFor(graph, waiverConcept))) reviewBlockers.push('competing_hypotheses_missing');
    if (rows.some((row) => !(row.supportingEvidenceIds || []).length)) reviewBlockers.push('hypothesis_without_evidence');
    if (rows.some((row) => row.status === 'contested')) reviewBlockers.push('unresolved_contradiction');
    reviewClaims.push(...rows);
  }

  if (rule.marketEvidence) {
    const market = Object.values(graph.evidence).filter((row) => row.type === 'market');
    if (market.some((row) => !row.publisher || !row.publishedAt || !row.jurisdiction)) reviewBlockers.push('market_provenance_incomplete');
    const nowMs = new Date(options.now || Date.now()).getTime();
    const maxAgeDays = Math.max(30, Number(rule.marketEvidence.maxAgeDays) || 730);
    if (market.some((row) => (row.validUntil && new Date(row.validUntil).getTime() < nowMs)
      || (row.publishedAt && (nowMs - new Date(row.publishedAt).getTime()) / 86400000 > maxAgeDays))) reviewBlockers.push('market_evidence_stale');
  }

  if (rule.selection) {
    const { artifactType, decisionKind } = rule.selection;
    const latest = Object.values(graph.artifacts).filter((row) => row.stage === stage && row.type === artifactType)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || null;
    const recommendedId = latest?.payload?.recommended?.id || null;
    if (latest && !recommendedId) reviewBlockers.push('eligible_option_missing');
    if (!approvalFor(graph, stage, decisionKind)) advanceBlockers.push('human_approval_missing');
    else if (!Object.values(graph.decisions).some((row) => row.stage === stage && row.kind === decisionKind
      && row.humanApproved && row.evidenceIds.length && recommendedId && row.choice === recommendedId)) advanceBlockers.push('selection_mismatch');
  }

  if (rule.approval && !approvalFor(graph, stage, rule.approval)) advanceBlockers.push('human_approval_missing');
  if (unsupported.length) reviewBlockers.push('unsupported_claims');

  const evidence = evidenceSummary(graph, reviewClaims);
  const review = [...new Set(missingForReview)];
  const advance = [...new Set(missingForAdvance)];
  const held = [...review, ...reviewBlockers];
  const reviewReady = held.length === 0 && evidence.grade !== 'contested';
  const canAdvance = reviewReady && advance.length === 0 && advanceBlockers.length === 0;
  const met = (missing) => Math.max(0, required.length - missing.filter((id) => required.includes(id)).length);
  return {
    stage,
    status: canAdvance ? 'confirmed' : reviewReady ? 'supported' : (reviewClaims.length ? 'developing' : 'insufficient'),
    reviewReady,
    canAdvance,
    coverage: { review: { met: met(review), total: required.length }, confirmed: { met: met(advance), total: required.length } },
    evidence,
    missingForReview: review,
    missingForAdvance: advance,
    unsupported: [...new Set(unsupported)],
    reviewBlockers: [...new Set(reviewBlockers)],
    advanceBlockers: [...new Set(advanceBlockers)],
    rationale: canAdvance
      ? `${stage} gate passed after evidence review and human approval`
      : reviewReady
        ? `${stage} is ready for client review but cannot advance: ${[...advance, ...new Set(advanceBlockers)].join(', ')}`
        : `${stage} review held: ${held.join(', ')}`,
  };
}

module.exports = { assessStage, evidenceSummary };
