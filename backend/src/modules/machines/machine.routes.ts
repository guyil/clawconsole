import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MachineService } from './machine.service.js';

const CreateMachineSchema = z.object({
  name: z.string().min(1).max(255),
  tailscaleHostname: z.string().min(1).max(255),
  sshUser: z.string().max(100).optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshPassword: z.string().max(255).optional(),
  openclawHome: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateMachineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sshUser: z.string().max(100).optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshPassword: z.string().max(255).nullable().optional(),
  openclawHome: z.string().max(500).optional(),
  tags: z.array(z.string()).optional(),
});

export function registerMachineRoutes(fastify: FastifyInstance, machineService: MachineService) {
  fastify.get('/api/machines', async (request) => {
    const query = request.query as Record<string, string>;
    const machines = await machineService.listMachines({
      status: query.status as any,
      tag: query.tag,
    });
    return { data: machines, total: machines.length };
  });

  fastify.post('/api/machines', async (request, reply) => {
    const body = CreateMachineSchema.parse(request.body);
    const machine = await machineService.createMachine(body);
    return reply.status(201).send(machine);
  });

  fastify.get('/api/machines/:machineId', async (request) => {
    const { machineId } = request.params as { machineId: string };
    return machineService.getMachine(machineId);
  });

  fastify.patch('/api/machines/:machineId', async (request) => {
    const { machineId } = request.params as { machineId: string };
    const body = UpdateMachineSchema.parse(request.body);
    return machineService.updateMachine(machineId, body);
  });

  fastify.delete('/api/machines/:machineId', async (request, reply) => {
    const { machineId } = request.params as { machineId: string };
    await machineService.deleteMachine(machineId);
    return reply.status(204).send();
  });

  fastify.post('/api/machines/:machineId/health-check', async (request) => {
    const { machineId } = request.params as { machineId: string };
    return machineService.healthCheck(machineId);
  });

  fastify.post('/api/machines/:machineId/discover', async (request) => {
    const { machineId } = request.params as { machineId: string };
    return machineService.discoverStructure(machineId);
  });
}
