import request from 'supertest';
import { describe, it } from 'vitest';

import { app } from '../../app';

describe.skip('Markets API', () => {
  const adminApiKey = process.env.ADMIN_API_KEY ?? 'test-key';

  it('registers a new market via admin endpoint', async () => {
    await request(app)
      .post('/api/v1/markets')
      .set('x-api-key', adminApiKey)
      .send({
        name: 'Test Market',
        ownerId: '00000000-0000-0000-0000-000000000001',
        entityId: '00000000-0000-0000-0000-000000000002',
        metadata: {}
      })
      .expect(201);
  });
});
