Seed files for the isolation suite (`../isolation.test.ts`). Each file exports
an optional `catalogue` list (global tables it adds) and an optional
`seed(db, companyId, branchId, userId)` that gives every company-scoped table
it adds at least one row, so the suite can prove companies cannot see each
other's rows.
