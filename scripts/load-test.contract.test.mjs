import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSessions,
  createMetrics,
  loadConfig,
  summarize,
} from './load-test.mjs'

test('the documented default is 200 VUs with distinct sessions', () => {
  const config = loadConfig({})
  const credentials = Array.from({ length: config.users }, (_, index) => ({
    identifier: `load-${index}@example.test`,
    password: 'test-password',
  }))
  const sessions = buildSessions(credentials, config)

  assert.equal(config.users, 200)
  assert.equal(sessions.length, 200)
  assert.equal(new Set(sessions.map((session) => session.jar)).size, 200)
  assert.equal(new Set(sessions.map((session) => session.credential.identifier)).size, 200)
})

test('summary separates attempted, successful, failed, and timed-out traffic', () => {
  const config = {
    ...loadConfig({ LOAD_USERS: '10', LOAD_DURATION_SECONDS: '10' }),
    users: 10,
    durationSeconds: 10,
  }
  const metrics = createMetrics()
  metrics.byEndpoint.set('workspace', {
    count: 10,
    ok: 8,
    failed: 2,
    timeouts: 1,
    bytes: 1000,
    durations: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    statuses: { 0: 1, 200: 8, 500: 1 },
  })

  const result = summarize(metrics, config, 'start', 'finish')

  assert.equal(result.attemptedRps, 1)
  assert.equal(result.successfulRps, 0.8)
  assert.equal(result.totalTimeouts, 1)
  assert.equal(result.endpoints.workspace.p50Ms, 50)
  assert.equal(result.endpoints.workspace.p95Ms, 100)
})
