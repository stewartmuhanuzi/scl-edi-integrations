# DCG integration — AWS SFTP + self-built X12 (design)

**Status: current direction (2026-07-29).** Supersedes the "Orderful hosts the
DCG SFTP + Convert" plan. The DCG warehouse leg no longer touches Orderful at
all — we generate/parse X12 ourselves and move files over an AWS bridge.
Orderful remains **only** for the retailer leg (850/856/810).

## Why this shape

- DCG self-hosts an SFTP server and whitelists a **static source IP**.
- n8n Cloud egresses from **dynamic** IPs, so it can't be whitelisted directly.
- **AWS Transfer Family SFTP _Connector_** solves exactly this: AWS acts as the
  SFTP *client*, connecting outbound to DCG's server from a stable set of
  static IPs that DCG whitelists, staging files in S3. Use the **Connector**
  (~$5–25/mo: per-transfer + S3 storage), **not** a Transfer Family *server*
  endpoint (~$216/mo) — DCG hosts the server, we only connect out.
- Removing Orderful from this leg also removes the trading-partnership
  relationship gate that was blocking 940/943/888 testing. The remaining
  dependency is just DCG's SFTP credentials, not a partner acceptance.

## Components

| Piece | Purpose |
|---|---|
| **S3 bucket** (`scl-dcg-sftp-bridge`) | Staging + immutable archive of every file both directions |
| **Transfer Family SFTP Connector** | Outbound SFTP client to DCG; DCG whitelists its static IPs |
| **AWS Secrets Manager** | DCG SFTP host/user/key or password |
| **IAM user for n8n** | Least-privilege: S3 get/put/list on the bucket + `transfer:StartFileTransfer` / `transfer:ListFileTransferResults` on the connector. Access key becomes an n8n AWS credential |
| **Supabase** | Existing control plane + a `files` table (lifecycle) + an X12 control-number sequence |

### S3 prefix layout

```
outbound/pending/    X12 we generated, awaiting push to DCG
outbound/sent/       archived after a confirmed push
inbound/received/    pulled from DCG, awaiting processing
inbound/processed/   archived after parse + AM writeback
errors/              anything that failed transform / transfer / parse
```

Never delete — archive. Every file is replayable from `sent/` or `processed/`.

## Outbound flow (AM → DCG): 888, 940, 943

One n8n flow per doc type (or one parameterized flow), standard skeleton:

1. **Trigger** — schedule, or reactive to AM state (e.g. order released → 940).
2. **Fetch source from AM** → canonical object via the existing parsers
   (`parsePickTicket` → 940, `parsePurchaseOrder` → 943, `parseItem` → 888).
3. **Claim/dedupe** in Supabase (idempotency on the business reference).
4. **Build X12** — canonical → X12 segments per DCG's spec, wrapped in an
   ISA/GS/ST…SE/GE/IEA envelope with a Supabase-issued interchange control
   number. (New adapter — see "X12 codec" below.)
5. **`S3 PutObject`** → `outbound/pending/<name>`.
6. **`StartFileTransfer` (SendFilePaths)** to DCG — called via the AWS API
   (SigV4) from n8n's HTTP Request node.
7. **Poll `ListFileTransferResults`** until `COMPLETED` (or log and reconcile
   asynchronously).
8. **On success** → copy S3 object to `outbound/sent/`, mark Supabase `sent`,
   record the `files` row + control number.
9. **On failure** → move to `errors/`, log to the errors table.

## Inbound flow (DCG → AM): 944, 945

1. **Schedule trigger** (e.g. every 15–30 min).
2. **`StartFileTransfer` (RetrieveFilePaths)** — list DCG's outbox and pull new
   files into `inbound/received/`.
3. For each new file: **`S3 GetObject`**.
4. **Parse X12** → canonical `Receipt` (944) / shipment confirmation (945).
5. **Correlation match** (DCG-spec'd round-trips):
   - 944 `W1704` ↔ the 943's `W0602`
   - 945 `W0602` ↔ the 940's `W0502`
   Look up the originating transaction in Supabase by that reference.
6. **Writeback to AM** (receipt against the PO for 944; ship-confirm against the
   order for 945) + Supabase status `processed`.
7. **945 processed → fire the retailer 856/810** via Execute Sub-workflow. This
   is the real post-945 trigger the outbound retailer flow has been waiting on.
8. **Archive** to `inbound/processed/`; failures to `errors/`.

## X12 codec — a new EDI adapter, not Orderful

Because this leg builds X12 in-house, DCG's "translator" is our own X12 codec,
which slots into the reusable structure as a new EDI adapter (see
`core/adapter-contract.md`). Proposed: `adapters/edi/x12-dcg/`

```
adapters/edi/x12-dcg/
  lib/envelope.js     ISA/GS/ST builder + parser, delimiters, control numbers
  lib/build940.js     canonical PickTicket    → 940 X12
  lib/build943.js     canonical PurchaseOrder → 943 X12
  lib/build888.js     canonical Item          → 888 X12  (item attributes, no pricing)
  lib/parse944.js     944 X12 → canonical Receipt
  lib/parse945.js     945 X12 → canonical shipment confirmation
  schema-notes.md     segment-level mapping, derived from dcg-specs/ + real samples
  README.md           envelope IDs, delimiters, DCG file conventions, gotchas
```

The canonical objects are **unchanged** — that's the payoff of the canonical
layer: swapping the DCG leg from Orderful to DIY-X12-over-SFTP doesn't touch
the ApparelMagic side at all. We already have real DCG samples + the VIDA
field-mapping guides in `dcg-specs/` to build these against, the same way
`parse850` was built against a real Orderful 850.

## Control numbers & idempotency

- **ISA13 interchange control number** must be unique/monotonic per interchange
  — issue from a Supabase sequence and log every number.
- **Outbound dedupe** on the business reference (shipment/order number) before
  generating, so a replay never double-sends.
- **Inbound dedupe** on (doc type + DCG's control number + business reference),
  so re-pulling a file never double-posts to AM.

## Connector status (confirmed 2026-07-29+)

The Connector is live and tested from both ends:

- **Connector ID** `c-71cf9ddb758b4376b`, egress type Service managed,
  `sftp://20.14.2.67:22`.
- **AWS account** "SCL Footwear" (`465573888733`), region **us-east-2 (Ohio)**
  — resolves the "which account" open item below.
- **Console "Test connection"** succeeds on our side; Mike separately
  confirmed connectivity from DCG's side and is ready to receive a file.
- **Decided (2026-07-30): proceed with 888**, per Mike's direction — his
  suggested first real test is an 888 with a few items. The earlier
  888-vs-832 concern was about the quality of DCG's specific 888 mapping
  spec (inherited VIDA cruft), not the transaction type itself — checked
  against general X12 usage, 888 (attributes only, no pricing) is actually
  the correct standard fit for a 3PL warehouse, which has no use for pricing
  data. See `dcg-integration-notes.md` for the full reasoning. First build
  target: `build888.js`.
- **Built (2026-07-30)**: `adapters/edi/x12-dcg/lib/{envelope,build888}.js`.
  Envelope framing (ISA/GS/ST…SE/GE/IEA, delimiters, control-number padding)
  verified byte-for-byte against `sample-888.txt`. Several 888 fields are
  documented assumptions pending Chi Cao's confirmation — see
  `adapters/edi/x12-dcg/schema-notes.md`.
- **Built (2026-07-30)**: `clients/scl-footwear/n8n/flows/888-outbound.json`
  — pulls a few real AM products/SKUs, ports the builder logic into a Code
  node, dedupes/logs to Supabase, `S3 PutObject`s the X12 file, then calls
  `StartFileTransfer` (verified against the real AWS Transfer Family API:
  `POST transfer.<region>.amazonaws.com`, header
  `X-Amz-Target: TransferService.StartFileTransfer`, body
  `{ ConnectorId, SendFilePaths: ["/bucket/key"] }`). Runs against the TEST
  stream with `usageIndicator: 'T'`. **S3 bucket confirmed** (2026-07-30):
  `scl-dcg-sftp-bridge`, region us-east-2 — created 2026-07-09, already wired
  into the flow. Not yet actually run against DCG — the schema-notes.md open
  questions (vendor name, ISA sender/receiver IDs, division code) should be
  resolved with Chi Cao before flipping to a real send.

## DCG's real SFTP credentials + directory structure (confirmed 2026-08-06)

From Chi Cao's original email (forwarded by Mike 2026-08-05), previously
only known via the connector's stored Secrets Manager credential, now
confirmed in writing:

- **Host**: `20.14.2.67`, port `22` (matches the connector)
- **User**: `SCLFW`
- **Password**: sent by DCG in a separate email — confirm it matches what's
  stored in Secrets Manager for the connector
- **Directory structure** — DCG expects files in specific subfolders, **not
  the SFTP user's home/root directory**:
  - Upload TEST files to `\From_SCL_TEST\` — download DCG's TEST files from `\To_SCL_TEST\`
  - Upload PROD files to `\From_SCL_PROD\` — download DCG's PROD files from `\To_SCL_PROD\`
- **DCG's own EDI ID (both TEST and PROD): `ZZ` / `DCG`** — confirms the
  `receiverQualifier: 'ZZ', receiverId: 'DCG'` already used in `build888.js`/
  `build940.js`/both n8n flows was correct, not just a placeholder.
- **Still open**: Chi Cao is waiting on **SCL's own EDI ID** (`ISA05`/`ISA06`)
  to configure on DCG's side. `senderId: 'SCLFOOTWEAR'` is still only our own
  placeholder — needs an actual decision from Mike/SCL, then a reply to Chi Cao.

**Real gap found because of this**: `StartFileTransfer`'s `SendFilePaths`
had no `RemoteDirectoryPath` set in either flow — per AWS's own docs, that
means transfers land in the SFTP user's **home directory**, not
`\From_SCL_TEST\`. **Fixed 2026-08-06**: both `888-outbound.json` and
`940-outbound.json` now pass `RemoteDirectoryPath: '/From_SCL_TEST'` in the
`StartFileTransfer` body.

**Confirmed the two earlier sends never actually reached DCG** — not just
suspected. Built `n8n/tools/check-dcg-directory.json` (a `StartDirectoryListing`
diagnostic — browses DCG's real SFTP folder directly, no waiting on Chi Cao)
and used it to check `\From_SCL_TEST\` directly: **`"files": []` — the folder
is empty.** Both the 888 (Aug 1) and 940 (Aug 6) test sends should be treated
as lost — DCG never saw them — and re-run now that the path fix (above) and
a second, separate permissions fix (below) are both in place.

**Second real gap found while building the diagnostic tool**: the connector's
own **execution role** (`scl-dcg-transfer-connector-role` — separate from the
`n8n-dcg-integration` IAM user; this is the role AWS's backend uses to
actually read/write S3 on the connector's behalf, not the role that calls the
API) was scoped only to the `scl-dcg-sftp-bridge/dcg/*` prefix. Since every
flow actually writes to `outbound/*`, **this same gap almost certainly caused
the original two "successful" sends to silently fail** — `StartFileTransfer`'s
immediate 200 response only confirms AWS *accepted the request*; actual
success requires the connector's role to read the source file from S3, which
it couldn't do outside `dcg/*`. We were never checking `ListFileTransferResults`
to catch this. **Fixed**: broadened that role's policy to also cover
`outbound/*` and `dcg-listings/*` (kept `dcg/*` intact). Confirmed working
afterward — the diagnostic tool successfully wrote and read back a real
listing file once the role was fixed.

**Third, deepest real gap — the actual root cause of both failed sends (found
2026-08-07)**: built `n8n/tools/check-transfer-result.json` (calls
`ListFileTransferResults` with a real `TransferId`, closing the blind-spot
above) and ran it against a fresh 888 send. Result: `StatusCode: 'FAILED'`,
`FailureCode: 'SEND_FILE_NOT_FOUND'`, `FilePath:
'/scl-dcg-sftp-bridge/outbound/pending/undefined'` — the literal string
`undefined` in the S3 key. Root cause: `StartFileTransfer`'s `SendFilePaths`
built its key from `$json.fileName`, but `$json` at that node is the
*immediately preceding* `Upload to S3` node's own output (`{success: true}`),
which does not pass through the original `fileName` field — n8n node output
is not a pass-through of input by default. `Upload to S3` itself is one hop
closer to `Reattach File + Metadata` (the node that actually sets
`fileName`), so *its* plain `$json.fileName` reference happened to work,
which is why files landed correctly in S3 under the right name — the break
was only in the next hop. **Fixed** in both `888-outbound.json` and
`940-outbound.json`: `StartFileTransfer`'s body now reads
`$('Reattach File + Metadata').item.json.fileName` (named cross-reference)
instead of `$json.fileName`, matching the pattern the downstream `Mark Sent`
node already used correctly. This is more fundamental than either fix above —
regardless of `RemoteDirectoryPath` or the connector-role scoping, every send
was always requesting a file path that could never exist. Verified: JSON
valid, and the `$('Reattach File + Metadata')` reference resolves to a real
connected path in both files. **Confirmed live 2026-08-10**: re-ran
`888-outbound.json` end to end with the fix applied, got a fresh `TransferId`
(`86983c78-bc33-4e67-b539-366d4e5c0862`), checked it with
`check-transfer-result.json`, and got back `StatusCode: 'COMPLETED'` —
`FilePath: /scl-dcg-sftp-bridge/outbound/pending/SCL_888_2026-08-10T17-12-34-503Z.txt`.
**This is the first genuinely confirmed delivery to DCG** — not just an
accepted request, an actual completed transfer.

**Follow-up still worth doing**: build a `ListFileTransferResults` poll
directly into `888-outbound.json`/`940-outbound.json` after `StartFileTransfer`
so future sends self-verify instead of needing a manual follow-up check with
`check-transfer-result.json`.

**Direct verification, not just waiting on DCG (added 2026-08-06)**:
`clients/scl-footwear/n8n/tools/check-dcg-directory.json` calls the
connector's `StartDirectoryListing` API to literally browse a folder on
DCG's real SFTP server and confirm what's actually there — no need to wait
for Chi Cao to check manually. Needs `transfer:StartDirectoryListing` added
to the IAM policy (already added to `n8n-aws-iam-policy.json`, needs saving
as a new policy version in the console). If it errors with `AccessDenied`
after that, check the *connector's own* execution role too (separate from
the n8n IAM user) — AWS's backend, not the caller, writes the listing output
file to S3, so the connector's role needs write access to
`scl-dcg-sftp-bridge/dcg-listings/`.

## IAM policy for n8n's AWS credential

`n8n-aws-iam-policy.json` (in this folder) is the least-privilege policy for
the IAM user n8n uses. Verified against AWS's real API docs rather than
guessed (action names and the connector ARN format both confirmed via AWS's
Transfer Family API reference and Service Authorization Reference):

- `s3:PutObject` / `s3:GetObject` on `scl-dcg-sftp-bridge/*`, `s3:ListBucket`
  on the bucket itself. No delete permission — this integration never
  deletes files, only archives (see "Control numbers & idempotency" above).
- `transfer:StartFileTransfer`, `transfer:ListFileTransferResults`,
  `transfer:DescribeConnector`, scoped to this one connector's ARN
  (`arn:aws:transfer:us-east-2:465573888733:connector/c-71cf9ddb758b4376b`).

**To set this up** (console, not something Claude can do on your AWS account):

1. IAM → Users → Create user (e.g. `n8n-dcg-integration`) — programmatic
   access only, no console password needed.
2. Attach a policy → "Create policy" → JSON tab → paste
   `n8n-aws-iam-policy.json`'s contents → name it (e.g.
   `n8n-dcg-sftp-bridge-policy`) → attach to the new user.
3. On the user, "Security credentials" tab → "Create access key" → choose
   "Third-party service" → copy the access key ID + secret (shown once).
4. In n8n: Credentials → New → AWS → paste the access key ID/secret, region
   `us-east-2` → name it **"AWS account"** (matches what `888-outbound.json`
   expects on import).

## To confirm before building

- DCG's actual folder structure and file-naming convention on their server —
  now browsable via the connector, confirm by listing the directory.
- X12 envelope IDs DCG expects for SCL (ISA05/06 sender qualifier+id, ISA07/08
  receiver).
- Order-flavor / 940 sub-type (already open in `dcg-integration-notes.md`) —
  still gates `build940`.
- Add the Supabase `files` table + control-number sequence (migration
  `0002_*`, not yet written — schema change is applied via `npm run migrate`).

## Fallback (on record, not the plan)

If hand-rolling X12 proves too costly, Orderful's **Convert API** could do just
the JSON↔X12 transformation while AWS still handles transport — but that
reintroduces an Orderful dependency on this leg, which is the exact risk this
pivot removes. Default to the DIY codec unless that changes.
