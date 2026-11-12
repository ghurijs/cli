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
    "@ghuri/admin": "{{adminRange}}",
    "@ghuri/auth": "{{authRange}}",
    "@ghuri/core": "{{coreRange}}",
{{#if graphql}}
    "@ghuri/graphql": "{{graphqlRange}}",
{{/if}}
    "@ghuri/orm": "{{ormRange}}",
    "@ghuri/rest": "{{restRange}}",
    "@ghuri/storage": "{{storageRange}}",
    "@hono/node-server": "^2.1.0",
{{#if sqlite}}
    "better-sqlite3": "^13.1.0",
{{/if}}
{{#if graphql}}
    "graphql": "^17.1.0",
{{/if}}
    "hono": "^4.13.0",
    "jiti": "^2.7.0",
    "postgres": "^4.1.0"
  },
  "devDependencies": {
{{#if cloudflare}}
    "@cloudflare/workers-types": "^5.20261110.0",
{{/if}}
    "@ghuri/cli": "{{cliRange}}",
    "@types/node": "^24.0.0",
{{#if !sqlite}}
    "better-sqlite3": "^13.1.0",
{{/if}}
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
