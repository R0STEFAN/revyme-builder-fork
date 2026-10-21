// server/automation/standalone.ts
import http from 'node:http';
import { createAutomationMiddleware } from './api';
import { LocalProjectRepository } from './project-repository';
import { CommitService } from './commit-service';

export function startStandaloneServer(port = 8085, customDataDir?: string): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  const repository = new LocalProjectRepository(customDataDir);
  const commitService = new CommitService(repository);
  const middleware = createAutomationMiddleware({ repository, commitService });

  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('Not found');
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      resolve({
        server,
        port,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      });
    });
    server.on('error', reject);
  });
}
