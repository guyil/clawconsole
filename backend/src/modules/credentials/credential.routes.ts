import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CredentialService } from './credential.service.js';

const CreateCredentialSchema = z.object({
  machineId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  credentialType: z.enum(['api_key', 'oauth_token', 'allow_from', 'pairing', 'webhook_secret', 'other']),
  provider: z.string().max(100).optional(),
  value: z.string().min(1),
  targetFilePath: z.string().max(500).optional(),
  description: z.string().optional(),
});

const UpdateCredentialSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  value: z.string().min(1).optional(),
  targetFilePath: z.string().max(500).optional(),
  description: z.string().optional(),
});

export function registerCredentialRoutes(fastify: FastifyInstance, credentialService: CredentialService) {
  fastify.get('/api/credentials', async (request) => {
    const query = request.query as Record<string, string>;
    const credentials = await credentialService.listCredentials({
      machineId: query.machineId,
      provider: query.provider,
    });
    return { data: credentials, total: credentials.length };
  });

  fastify.get('/api/credentials/:credentialId', async (request) => {
    const { credentialId } = request.params as { credentialId: string };
    return credentialService.getCredential(credentialId);
  });

  fastify.post('/api/credentials', async (request, reply) => {
    const body = CreateCredentialSchema.parse(request.body);
    const credential = await credentialService.createCredential(body);
    return reply.status(201).send(credential);
  });

  fastify.patch('/api/credentials/:credentialId', async (request) => {
    const { credentialId } = request.params as { credentialId: string };
    const body = UpdateCredentialSchema.parse(request.body);
    return credentialService.updateCredential(credentialId, body);
  });

  fastify.delete('/api/credentials/:credentialId', async (request, reply) => {
    const { credentialId } = request.params as { credentialId: string };
    await credentialService.deleteCredential(credentialId);
    return reply.status(204).send();
  });

  fastify.post('/api/credentials/:credentialId/sync/:machineId', async (request) => {
    const { credentialId, machineId } = request.params as { credentialId: string; machineId: string };
    await credentialService.syncCredentialToMachine(credentialId, machineId);
    return { success: true, credentialId, machineId };
  });

  fastify.post('/api/machines/:machineId/credentials/sync-all', async (request) => {
    const { machineId } = request.params as { machineId: string };
    return credentialService.syncAllCredentialsToMachine(machineId);
  });
}
