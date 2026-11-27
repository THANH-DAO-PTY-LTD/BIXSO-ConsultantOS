# Contributing

Use a GitHub issue for feedback or a bug. Include a fictional engagement, the commands you ran, the result you expected and what happened. For a new gate rule, describe the decision it protects and the evidence that should satisfy it.

1. Clone the repo and create a branch with `git switch -c fix/short-description`.
2. Run `npm test` and `npm run demo`.
3. Add a test that captures the behaviour, make the smallest change, and run `npm test` again.
4. Open a PR with the linked issue, a short description and your test result. The maintainer checks the change and CI before merging.

Changes that let a hypothesis advance a stage, record a fact without evidence or skip a human approval need an issue first. Playbooks for specific industries are welcome under `playbooks/`.

Submit only material you have the right to contribute. Contributions to this repository are provided under its [MIT license](LICENSE).
