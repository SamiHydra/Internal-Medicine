# Data-retention policy question

No archive or deletion policy is implemented by this work order. The department
must first define the clinical, legal, audit, teaching, and research retention
periods in writing.

The following high-volume facts currently grow without a domain retention
limit:

| Fact type | Current audited rows | Estimated +1 year | Estimated +3 years |
|---|---:|---:|---:|
| Report field values | 249,554 | 99,000 | 297,000 |
| Evaluations | 3,720 | 3,600 | 10,800 |
| Evaluation answers | 35,060 | 34,000 | 102,000 |
| Morning attendance | 23,380 | 22,000 | 66,000 |
| Student attendance | 9,925 | 14,000 | 42,000 |
| Teaching sessions | 413 | 580 | 1,740 |

These are planning increments, not precise forecasts: the reporting seed spans
about 2.5 years while academic operations span about one year. Across all fact
types, the audit projects roughly 174,000 added rows per year and 522,000 over
three years. Raw disk is not the first three-year bottleneck, but backup,
restore, export, and any unbounded query costs continue to grow.

The written policy must answer:

1. How long must submitted report facts remain online?
2. How long must evaluations, answers, and attendance remain online?
3. Which records must remain immutable for clinical, legal, accreditation, or
   audit purposes?
4. Is an authenticated archive/export acceptable after the online period?
5. Who approves deletion, and what restore evidence is required first?

Only after those answers should the team design archival, rollups,
partitioning, or deletion.
