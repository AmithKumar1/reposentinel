import { Context } from 'probot';
import { logger } from '../utils/logger.js';
import { queueBrainIndex } from '../services/brain-queue.js';
import { getRepoConfig } from '../config/repo-config.js';

export async function handlePush(context: Context<'push'>) {
  const { repository, payload } = context;
  const { ref, commits, after } = payload;
  
  logger.info({ repo: repository.full_name, ref, commits: commits.length }, 'Push event received');
  
  // Skip if not default branch (configurable)
  const config = await getRepoConfig(context);
  if (config.branches && !config.branches.includes(ref.replace('refs/heads/', ''))) {
    logger.debug({ ref }, 'Skipping non-configured branch');
    return;
  }
  
  // Queue brain indexer to update knowledge graph
  await queueBrainIndex({
    repoId: repository.id.toString(),
    repoName: repository.full_name,
    owner: repository.owner.login,
    ref: ref.replace('refs/heads/', ''),
    commitSha: after,
    changedFiles: commits.flatMap(c => c.added.concat(c.modified, c.removed))
  });
  
  // Comment on push if it's a significant change
  const totalChanges = commits.reduce((acc, c) => acc + c.added.length + c.removed.length, 0);
  if (totalChanges > 100 && config.notifyOnLargeChanges) {
    await context.octokit.repos.createCommitComment({
      owner: repository.owner.login,
      repo: repository.name,
      commit_sha: after,
      body: `🔍 **RepoSentinel**: Large change detected (${totalChanges} lines). I'll analyze this for potential refactoring opportunities.`
    });
  }
  
  logger.info({ repo: repository.full_name }, 'Push event processed');
}
