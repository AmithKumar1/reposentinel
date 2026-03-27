import { Probot } from 'probot';
import { handlePush } from './handlers/push.js';
import { handlePullRequest } from './handlers/pull-request.js';
import { handleSchedule } from './handlers/schedule.js';
import { logger } from './utils/logger.js';

export default (app: Probot) => {
  app.on('push', async (context) => {
    try {
      await handlePush(context);
    } catch (error) {
      logger.error({ error }, 'Error handling push event');
    }
  });

  app.on('pull_request', async (context) => {
    try {
      await handlePullRequest(context);
    } catch (error) {
      logger.error({ error }, 'Error handling pull_request event');
    }
  });

  app.on('schedule.repository', async (context) => {
    try {
      await handleSchedule(context);
    } catch (error) {
      logger.error({ error }, 'Error handling schedule event');
    }
  });

  app.on('issues.opened', async (context) => {
    try {
      const issue = context.issue();
      const body = issue.body || '';
      
      // Check if issue is asking RepoSentinel to analyze something
      if (body.includes('@reposentinel') || body.includes('/analyze')) {
        await context.octokit.issues.createComment({
          owner: issue.owner,
          repo: issue.repo,
          issue_number: issue.issue_number,
          body: `👋 **RepoSentinel here!** I'm analyzing your codebase now. Check back in a few minutes for my findings.`
        });
        
        // Trigger analysis
        await handleSchedule(context as any);
      }
    } catch (error) {
      logger.error({ error }, 'Error handling issue');
    }
  });

  app.onAny(async (event) => {
    logger.debug({ event: event.name }, 'GitHub event received');
  });

  app.onError((error) => {
    logger.error({ error }, 'RepoSentinel GitHub App error');
  });
};
