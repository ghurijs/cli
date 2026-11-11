{
  "name": "{{pkgName}}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "ghuri": {
    "settings": "src/settings.ts"
  },
  "scripts": {
{{#if cloudflare}}
    "dev": "ghuri runserver",
    "deploy": "ghuri deploy",
{{else}}
    "dev": "ghuri runserver --node",
{{/if}}
    "start": "node --import jiti/register src/server.ts",
    "migrate": "ghuri migrate",
    "makemigrations": "ghuri makemigrations",
    "check": "ghuri check",
    "test": "ghuri test",
    "typecheck": "tsc --noEmit",
    "ghuri": "ghuri"
  },
  "dependencies": {
    "@ghuri/admin": "^0.1.0-alpha.0",
    "@ghuri/auth": "^0.1.0-alpha.0",
    "@ghuri/core": "^0.1.0-alpha.0",
    "@ghuri/orm": "^0.1.0-alpha.0",
    "@ghuri/rest": "^0.1.0-alpha.0",
    "@ghuri/storage": "^0.1.0-alpha.0",
    "@hono/node-server": "^2.1.0",
{{#if sqlite}}
    "better-sqlite3": "^13.1.0",
{{/if}}
    "hono": "^4.13.0",
    "jiti": "^2.7.0",
    "postgres": "^4.1.0"
  },
  "devDependencies": {
{{#if cloudflare}}
    "@cloudflare/workers-types": "^5.20261110.0",
{{/if}}
    "@ghuri/cli": "^0.1.0-alpha.0",
    "@types/node": "^24.0.0",
    "typescript": "~5.9.3",
{{#if cloudflare}}
    "vitest": "^5.1.0",
    "wrangler": "^4.160.0"
{{else}}
    "vitest": "^5.1.0"
{{/if}}
  },
  "engines": {
    "node": ">=20"
  }
}
