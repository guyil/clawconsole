import type { CredentialRepository } from './credential.repository.js';
import type { Credential, CreateCredentialInput, UpdateCredentialInput } from './credential.types.js';
import type { FileTransfer } from '../../transport/file-transfer.js';
import type { MachineService } from '../machines/machine.service.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('credential-service');

export class CredentialService {
  constructor(
    private repo: CredentialRepository,
    private fileTransfer: FileTransfer,
    private machineService: MachineService,
  ) {}

  async listCredentials(filters?: { machineId?: string; provider?: string }): Promise<Credential[]> {
    return this.repo.findAll(filters);
  }

  async getCredential(id: string): Promise<Credential> {
    const cred = await this.repo.findById(id);
    if (!cred) throw new NotFoundError('Credential', id);
    return cred;
  }

  async createCredential(input: CreateCredentialInput): Promise<Credential> {
    if (!input.value || input.value.trim().length === 0) {
      throw new ValidationError('Credential value cannot be empty');
    }
    return this.repo.create(input);
  }

  async updateCredential(id: string, input: UpdateCredentialInput): Promise<Credential> {
    await this.getCredential(id);

    if (input.value) {
      await this.repo.updateValue(id, input.value);
    }

    const metaUpdates: { name?: string; targetFilePath?: string; description?: string } = {};
    if (input.name !== undefined) metaUpdates.name = input.name;
    if (input.targetFilePath !== undefined) metaUpdates.targetFilePath = input.targetFilePath;
    if (input.description !== undefined) metaUpdates.description = input.description;

    if (Object.keys(metaUpdates).length > 0) {
      await this.repo.updateMeta(id, metaUpdates);
    }

    return (await this.repo.findById(id))!;
  }

  async deleteCredential(id: string): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw new NotFoundError('Credential', id);
  }

  async syncCredentialToMachine(credentialId: string, machineId: string): Promise<void> {
    const cred = await this.getCredential(credentialId);
    if (!cred.targetFilePath) {
      throw new ValidationError('Credential has no target file path configured');
    }

    const decrypted = await this.repo.getDecryptedValue(credentialId);
    if (!decrypted) {
      throw new NotFoundError('Credential', credentialId);
    }

    const machine = await this.machineService.getMachine(machineId);
    const connInfo = this.machineService.toConnectionInfo(machine);
    const remotePath = `${machine.openclawHome}/${cred.targetFilePath}`;

    const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
    await this.fileTransfer.ensureDirectory(connInfo, dir);
    await this.fileTransfer.uploadCredential(connInfo, remotePath, decrypted);

    log.info(
      { credentialId, machineId, targetPath: cred.targetFilePath },
      'Credential synced to machine',
    );
  }

  async syncAllCredentialsToMachine(machineId: string): Promise<{ synced: number; failed: number }> {
    const credentials = await this.repo.findAll({ machineId });
    let synced = 0;
    let failed = 0;

    for (const cred of credentials) {
      if (!cred.targetFilePath) continue;

      try {
        await this.syncCredentialToMachine(cred.id, machineId);
        synced++;
      } catch (err) {
        failed++;
        log.error({ credentialId: cred.id, machineId, err }, 'Failed to sync credential');
      }
    }

    return { synced, failed };
  }
}
