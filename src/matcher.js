'use strict';

/**
 * Deterministic option matcher. An assistant may explain the ranked result,
 * but it cannot bypass prerequisites or promote a heavier option when a
 * lighter one satisfies the same capability. The catalogue comes from the
 * playbook; see playbooks/small-business-review.json.
 */

const EVIDENCE_LEVEL = Object.freeze({ insufficient: 0, contested: 0, developing: 1, supported: 2, confirmed: 3 });

function boolReason(key) {
  return {
    dataReady: 'dependable_data_missing', processStable: 'process_not_stable', integrationReadiness: 'integration_not_ready',
    authorityDefined: 'decision_authority_missing', humanReview: 'human_review_missing', fallbackDefined: 'fallback_missing',
  }[key] || `prerequisite_missing:${key}`;
}

function eligibility(candidate, context) {
  const reasons = [];
  for (const [key, expected] of Object.entries(candidate.prerequisites || {})) {
    if (key === 'minEvidence') {
      if ((EVIDENCE_LEVEL[context.evidenceStrength] || 0) < (EVIDENCE_LEVEL[expected] || 0)) reasons.push(`evidence_below:${expected}`);
    } else if (context[key] !== expected) reasons.push(boolReason(key));
  }
  return { eligible: reasons.length === 0, reasons };
}

function matchSolutions(context = {}, catalogue = []) {
  if (!Array.isArray(catalogue) || !catalogue.length) throw new Error('An options catalogue is required');
  const needs = [...new Set((context.desiredCapabilities || []).map(String))];
  const maxLevel = Number.isFinite(Number(context.maxLevel)) ? Number(context.maxLevel) : 5;
  const rows = catalogue.map((candidate) => {
    const gate = eligibility(candidate, context);
    const matched = candidate.capabilities.filter((item) => needs.includes(item));
    const capabilityScore = needs.length ? matched.length / needs.length : 0;
    const exceedsLadder = Number(candidate.level) > maxLevel;
    const capabilityMismatch = needs.length > 0 && matched.length === 0 && candidate.type !== 'measure';
    const eligible = gate.eligible && !exceedsLadder && !capabilityMismatch;
    const bestWhen = Object.entries(candidate.bestWhen || {}).reduce((score, [key, expected]) => {
      const pass = Array.isArray(expected) ? expected.includes(context[key]) : context[key] === expected;
      return score + (pass ? 18 : 0);
    }, 0);
    // Lighter sufficient options win ties. Capability fit dominates convenience.
    const score = eligible ? Math.round((capabilityScore * 70) + bestWhen + Math.max(0, 12 - Number(candidate.level) * 3)) : 0;
    return {
      id: candidate.id, type: candidate.type, label: candidate.label, level: candidate.level,
      eligible, score, matchedCapabilities: matched,
      rejectedReasons: [...gate.reasons, ...(exceedsLadder ? [`level_above:${maxLevel}`] : []), ...(capabilityMismatch ? ['capability_mismatch'] : [])],
    };
  });
  const eligible = rows.filter((row) => row.eligible).sort((a, b) => b.score - a.score || a.level - b.level || a.id.localeCompare(b.id));
  const ineligible = rows.filter((row) => !row.eligible);
  return {
    recommended: eligible[0] || null,
    eligible,
    ineligible,
    requiresHumanApproval: true,
    rationale: eligible[0] ? `Lowest justified match: ${eligible[0].id} (level ${eligible[0].level})` : 'No catalogue option passed the deterministic prerequisites',
  };
}

module.exports = { EVIDENCE_LEVEL, eligibility, matchSolutions };
