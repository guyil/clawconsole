/**
 * User management (admin-only). Access control is enforced upstream by the
 * global authz preHandler — developers are default-denied from every
 * ``/api/users`` path, so these handlers only ever run for admins.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import type { UserService } from './user.service.js';

const CreateSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  role: z.enum(['admin', 'developer']),
});

const UpdateSchema = z.object({
  password: z.string().min(1).optional(),
  role: z.enum(['admin', 'developer']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const AssignSchema = z.object({
  agentIds: z.array(z.string()).default([]),
});

export function registerUserRoutes(fastify: FastifyInstance, service: UserService): void {
  fastify.get('/api/users', async () => {
    const data = await service.listUsers();
    return { data, total: data.length };
  });

  fastify.post('/api/users', async (request, reply) => {
    const body = CreateSchema.parse(request.body);
    const user = await service.createUser(body);
    return reply.status(201).send(user);
  });

  fastify.patch<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    const body = UpdateSchema.parse(request.body);
    if (Object.keys(body).length === 0) {
      throw new AppError('没有需要更新的字段', 'VALIDATION_ERROR', 400);
    }
    return service.updateUser(request.params.id, body);
  });

  fastify.delete<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    await service.deleteUser(request.params.id);
    return { ok: true };
  });

  fastify.get<{ Params: { id: string } }>('/api/users/:id/agents', async (request) => {
    const agentIds = await service.getAssignedAgentIds(request.params.id);
    return { data: agentIds };
  });

  fastify.put<{ Params: { id: string } }>('/api/users/:id/agents', async (request) => {
    const body = AssignSchema.parse(request.body);
    const agentIds = await service.setAssignments(request.params.id, body.agentIds);
    return { data: agentIds };
  });
}
