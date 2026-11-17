import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import { createActor, createIdentity, ethrProviderName, KMS_NAME } from 'trust-aware-agentic-ai'
import { OFFLINE_NETWORK, tempDir } from './helpers.js'

describe('actor', () => {
  const data = tempDir('actor')
  after(() => data.cleanup())

  it('names the did:ethr provider after the network', () => {
    assert.equal(ethrProviderName('development'), 'did:ethr:development')
  })

  it('keeps identities and keys in its own encrypted database', async () => {
    const secretKey = randomBytes(32).toString('hex')
    const first = await createActor({ name: 'caa', dataDir: data.dir, ethr: OFFLINE_NETWORK, secretKey })
    const id = await createIdentity(first, { alias: 'caa' })
    await first.close()
    assert.ok(existsSync(first.dbFile))

    const reopened = await createActor({ name: 'caa', dataDir: data.dir, ethr: OFFLINE_NETWORK, secretKey, fresh: false })
    try {
      const found = await reopened.agent.didManagerGet({ did: id.did })
      assert.equal(found.alias, 'caa')
      assert.equal(found.keys[0]?.kms, KMS_NAME)
      // The private key is still usable: it decrypts with the same secret.
      const signature = await reopened.agent.keyManagerSign({
        keyRef: found.controllerKeyId!,
        data: 'hello',
        algorithm: 'ES256K',
      })
      assert.ok(signature.length > 0)
    } finally {
      await reopened.close()
    }
  })

  it('starts from an empty database unless asked to keep it', async () => {
    const actor = await createActor({ name: 'caa', dataDir: data.dir, ethr: OFFLINE_NETWORK })
    try {
      assert.deepEqual(await actor.agent.didManagerFind(), [])
    } finally {
      await actor.close()
    }
  })

  it('never sees the identities or keys of another actor', async () => {
    const [ita, booking] = await Promise.all(
      ['ita', 'booking'].map((name) => createActor({ name, dataDir: data.dir, ethr: OFFLINE_NETWORK })),
    )
    try {
      const itaId = await createIdentity(ita!)
      await assert.rejects(booking!.agent.didManagerGet({ did: itaId.did }))
      await assert.rejects(booking!.agent.keyManagerGet({ kid: itaId.controllerKeyId! }))
    } finally {
      await Promise.all([ita!.close(), booking!.close()])
    }
  })
})
