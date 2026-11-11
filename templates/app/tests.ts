// Tests for the '{{name}}' app — `npx ghuri test` (vitest).
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { index } from './views'

describe('{{name}}', () => {
  it('index view returns JSON', async () => {
    const app = new Hono().get('/', index)
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ app: '{{name}}' })
  })
})

// Full-stack tests with the test client (sessions, CSRF, database):
//
// import { createApp } from '@ghuri/core'
// import { createTestClient } from '@ghuri/core/testing'
// import settings from '../settings'
//
// const client = createTestClient(createApp(settings), { env: { SECRET_KEY: 'test', DEBUG: 'true' } })
// const res = await client.get('/{{name}}/')
