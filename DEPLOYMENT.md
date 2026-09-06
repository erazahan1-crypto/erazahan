# Cloudflare Pages deployment

The public site is a static Astro build. The Pages Function at `functions/api/dreams.ts` accepts `POST /api/dreams` and stores each submission in Cloudflare D1. The D1 binding name is `DREAMS_DB` everywhere: the function, `wrangler.jsonc`, and the Pages dashboard.

## A. Local commands

Run these commands in the project directory before the first deploy:

```powershell
npm install
npm run build
npx wrangler pages functions build functions --outdir "$env:TEMP\erazahan-pages-functions"
npx wrangler login
```

`npm run build` must finish successfully and create `dist`. The final Wrangler command checks the Pages Function without deploying it.

## B. Create D1

1. Sign in with `npx wrangler login`.
2. Create the production database:

   ```powershell
   npx wrangler d1 create erazahan-dreams
   ```

3. Wrangler prints a `database_id`. Copy that value.

## C. Set the database ID

Open `wrangler.jsonc` and replace only this value:

```json
"database_id": "REPLACE_WITH_D1_DATABASE_ID"
```

Paste the real `database_id` from the creation command. Do not change the binding name `DREAMS_DB`.

## D. Apply the migration

Create the `dreams` table in the remote D1 database:

```powershell
npx wrangler d1 execute erazahan-dreams --remote --file=migrations/0001_create_dreams.sql
```

## E. Create a Cloudflare Pages project

1. Push this project, including `functions/`, `migrations/`, and `wrangler.jsonc`, to GitHub or GitLab.
2. In Cloudflare, open **Workers & Pages**, choose **Create application**, then **Pages**, then **Connect to Git**.
3. Select the repository and choose the production branch, normally `main`.

Git deployment is required for the first production deployment because Pages detects and deploys the native `functions/` directory together with the built static site. `wrangler pages deploy dist` uploads static assets only.

## F. Build settings

In the Pages project setup, use:

- Framework preset: `Astro`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22`

## G. Bind D1 to Pages

After the Pages project is created, open **Settings** > **Bindings** > **Add** > **D1 database**.

- Variable name: `DREAMS_DB`
- D1 database: `erazahan-dreams`
- Environment: `Production`

Add the same binding for Preview if you use preview deployments. The variable name must remain exactly `DREAMS_DB`.

## H. Environment variables and secrets

No secret is required for D1. Optionally, to request a notification email for each submitted dream, add this encrypted secret in **Settings** > **Variables and Secrets**:

- Name: `DREAMS_EMAIL`
- Value: destination email address

Leave it unset if email notifications are not needed. D1 storage still works.

## I. First deploy

Finish the Pages setup and select **Save and Deploy**. Cloudflare runs `npm run build`, uploads `dist`, and deploys `functions/api/dreams.ts`. For later deploys, push a commit to the selected production branch.

## J. Verify D1 writes

After the Pages deployment completes, submit a test request. Replace the URL with the Pages URL shown in the dashboard:

```powershell
curl.exe -i -X POST "https://YOUR_PROJECT.pages.dev/api/dreams" -F "name=Test" -F "dream=Cloudflare D1 test"
```

The response must be `200` and contain `{"ok":true}`. Then verify the stored row:

```powershell
npx wrangler d1 execute erazahan-dreams --remote --command "SELECT id, name, dream, created_at FROM dreams ORDER BY created_at DESC LIMIT 10;"
```

The test entry must appear in the result. A `503` response means the `DREAMS_DB` binding is missing or points to the wrong database.

## K. Connect the custom domain

After the Pages URL and D1 test work, open the Pages project, go to **Custom domains**, then choose **Set up a custom domain**. Enter `erazahan.info` and follow Cloudflare's DNS instructions. If the domain's DNS zone is already managed by Cloudflare, it creates the required record automatically; otherwise add the displayed CNAME record at the current DNS provider. Confirm the domain only after Cloudflare reports it as active.

## Content updates

Content is versioned JSON in `src/data/`, not a hosted database. Updating content requires a commit and a new Pages deployment. Keystatic runs only in local development because its local-storage mode needs a writable filesystem; it is excluded from production builds.