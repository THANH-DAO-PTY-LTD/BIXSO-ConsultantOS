# Writing a playbook

A playbook is a JSON file with `id`, `title`, `stages` and `catalogue`. Stage order is the order of the `stages` array. Concept ids are free text; the convention `<stage>.<name>` keeps them readable.

## Stage rules

| Field | Effect |
| --- | --- |
| `id`, `label` | Stage identifier and display name. Required, unique. |
| `required` | Concepts that must exist (as a fact or hypothesis) for review, and as client-confirmed facts to advance. |
| `approval` | Decision kind, usually `stage_confirmation`, that a human must record with evidence before the stage can advance. |
| `artifacts` | `[{ "type", "minClaims" }]`. The stage needs an artifact of that type linked to at least `minClaims` facts or hypotheses. |
| `baselineOneOf` | At least one of these concepts must exist. Use it to force "we measured it" or "we know we have not measured it yet". |
| `competingHypotheses` | `{ "kind", "min", "waiverConcept" }`. Needs `min` evidenced hypotheses of this kind, unless the waiver concept explains why one is enough. Contested hypotheses block review. |
| `marketEvidence` | `{ "maxAgeDays" }`. Market evidence must name a publisher, jurisdiction and publication date, and be newer than the limit. |
| `selection` | `{ "artifactType", "decisionKind" }`. A human-approved decision must choose exactly the option the latest comparison recommended. |

## Options catalogue

Each option has `id`, `type`, `level` (lighter options have lower numbers), `label`, `capabilities`, `prerequisites` and optional `bestWhen`. Prerequisites are booleans in the matching context (`dataReady`, `processStable`, `integrationReadiness`, `authorityDefined`, `humanReview`, `fallbackDefined`) plus `minEvidence` (`developing`, `supported` or `confirmed`). An option of type `measure` stays eligible when no capability matches.
