import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { EnvsService } from '../envs/envs.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: EnvsService,
          useValue: {
            awsConfig: {
              region: 'us-east-1',
              accessKeyId: 'test-access-key',
              secretAccessKey: 'test-secret-key',
              s3BucketName: 'test-bucket',
            },
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
