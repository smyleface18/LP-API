import { Test, TestingModule } from '@nestjs/testing';
import { PutObjectCommand } from '@aws-sdk/client-s3';
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

  it('putObject sends a PutObjectCommand to the configured bucket', async () => {
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { client: { send: jest.Mock } }).client.send = send;

    const body = Buffer.from('audio');
    await service.putObject('stories/s1/panel-0.mp3', body, 'audio/mpeg');

    expect(send).toHaveBeenCalledTimes(1);
    const [[command]] = send.mock.calls as [[PutObjectCommand]];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'stories/s1/panel-0.mp3',
      Body: body,
      ContentType: 'audio/mpeg',
    });
  });
});
