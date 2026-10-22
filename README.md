# ZimERP

One Zimbabwean business platform: ERP, website, online store, email and domains, connected end to end.

- Plan: [`docs/ZimERP-master-plan.md`](docs/ZimERP-master-plan.md) ([PDF](docs/ZimERP-master-plan.pdf))
- Roadmap: GitHub issues, grouped into phase epics
- Contributor and AI guide: [`CLAUDE.md`](CLAUDE.md)

## Getting started

Needs Node 22 and PostgreSQL 16.

```
npm install
cp .env.example .env.local      # then edit; see the comments in the file
npm run db:dev                  # creates the dev database and applies migrations
npm run dev                     # http://localhost:3000
```

Companies live on subdomains, so point a test domain at your machine. With
`ZIMERP_PLATFORM_DOMAIN=zimerp.test`, add to your hosts file:

```
127.0.0.1  zimerp.test erp.mhofu.zimerp.test mhofu.zimerp.test
```

Open http://zimerp.test:3000/signup, create a company with the address `mhofu`
and you land on its ERP at http://erp.mhofu.zimerp.test:3000. Development
sign-in asks only for an email address (`AUTH_MODE=dev`) and is refused in
production.

Database tests need PostgreSQL 16:

```
DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run test:db
```

Proprietary and confidential. All rights reserved.
