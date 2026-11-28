# BIXSO Consulting OS

An evidence-first record of a consulting engagement, for independent consultants and small advisory teams. It keeps what the client confirmed, what you suspect and what the evidence says in separate places, and it will not let a stage close on a guess.

- **Facts need evidence.** Every client-confirmed fact cites at least one piece of evidence. Changing a fact needs an explicit supersession and a reason.
- **Hypotheses stay hypotheses.** A working guess, including one drafted by an AI tool, can make a stage ready for client review but can never advance it. When a fact arrives, matching hypotheses are confirmed or rejected automatically.
- **No repeated questions.** The question planner refuses to ask the client about something already known, already asked or a paraphrase of either, unless there is a recorded contradiction or the client changed their position.
- **Stage gates you define.** A playbook lists each stage's required concepts, artifacts, competing explanations, baselines, market-evidence freshness and the human approval needed to move on.
- **Lightest option first.** The option matcher checks prerequisites such as dependable data, a named decision owner, human review and a fallback, and prefers the lighter option when two would solve the same need. A person still decides.

## Try it

Use Node.js 22 or later. There are no dependencies to install.

```sh
npm test
npm run demo
```

The demo follows a fictional two-person bakery whose catering quotes are slow, through intake, diagnosis and options.

Run your own engagement from the command line. Data is saved in `.consulting-os/<name>.json` in the current folder.

```sh
node bin/consultingos.js new acme
node bin/consultingos.js evidence acme --type client --source call-1 --excerpt "Owner wants quotes out within two days." --reliability high
node bin/consultingos.js fact acme intake.goal "Quotes within two working days" --evidence <evidence-id>
node bin/consultingos.js gate acme intake
node bin/consultingos.js options acme --need standardisation,drafting --yes processStable
node bin/consultingos.js help
```

## Bring your own method

The engine has no built-in consulting method. Stages, gate rules and the options catalogue live in a playbook file. The included [small business review](playbooks/small-business-review.json) playbook (intake → diagnosis → options → decision) is an example. See [docs/PLAYBOOK.md](docs/PLAYBOOK.md) to write your own and start an engagement with `--playbook your-file.json`.

## Limits of this preview

- One person, one computer. Engagements are JSON files with no locking, sync or backup.
- There is no AI in this release. The engine is designed so that an assistant can propose hypotheses, questions and option explanations, while the rules above decide what counts.
- It is a record and a set of checks, not advice. Use fictional records when you report issues.

## Use it as a library

```js
const cos = require('./src');
const playbook = cos.loadPlaybook();
let graph = cos.createGraph({ engagementId: 'acme', stages: playbook.stages.map((s) => s.id) });
const gate = cos.assessStage(graph, 'intake', playbook);
```

Every function returns a new graph and leaves the previous one unchanged.

## Help shape it

Open an [issue](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Consulting-OS/issues) with a gate rule your method needs or a check that blocked you wrongly. See [CONTRIBUTING](CONTRIBUTING.md) and the [security policy](SECURITY.md).

<!-- bixso-os-family:start -->
## BIXSO OS family

Small, local-first, MIT-licensed tools for running real work, each built from the rules of a BIXSO product.

| Project | What it does |
| --- | --- |
| [BIXSO Service OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Service-OS) | Run a one-person service business: Company, Flow and Work in a local web app. |
| [BIXSO Sourcing OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Sourcing-OS) | B2B sourcing workflows from RFQ to delivered order, with a receipt for every step. |
| [BIXSO Consulting OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Consulting-OS) (this project) | An evidence-first record of a consulting engagement. |
| [BIXSO Construction OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Construction-OS) | An outdoor or landscape job from site survey to handover. |
| [BIXSO Paperwork OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Paperwork-OS) | One shared record of a paperwork matter between a client and their professionals. |
| [BIXSO Travel OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Travel-OS) | Trip plans where every suggestion explains itself, plus traveller-host meetups. |
| [BIXSO Sport OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Sport-OS) | Community pickup games with a fair waitlist, check-in and results. |
| [BIXSO Social OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Social-OS) | Connections and a trust ledger that moves only on independent receipts. |
| [BIXSO Academy OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Academy-OS) | Learning evidence where AI gives feedback and people verify. |

Release news, questions and ideas: [r/BIXSO](https://www.reddit.com/r/BIXSO/).

## Work with BIXSO

Want this set up for your business, or shaped around how your team actually works? BIXSO provides business workflow advisory and implementation. See [bixso.ai](https://bixso.ai/?utm_source=github&utm_medium=readme&utm_campaign=bixso-os&utm_content=consulting-os).
<!-- bixso-os-family:end -->

## License

[MIT](LICENSE) · Copyright (c) 2026 Thanh Dao Pty Ltd. See [docs/PROVENANCE.md](docs/PROVENANCE.md).

The software is provided under the MIT license. Nothing in that license or in this repository excludes, restricts or modifies any right or remedy you have under the Australian Consumer Law, or any other law, that cannot lawfully be excluded.

BIXSO and the BIXSO logo are trademarks of Thanh Dao Pty Ltd. The MIT license covers the code, not the names or logo; see [TRADEMARKS.md](TRADEMARKS.md).
