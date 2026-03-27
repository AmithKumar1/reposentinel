import { Context } from 'probot';
import { logger } from '../utils/logger.js';
import { triggerCampaign } from '../services/campaign-manager.js';

export async function handleSchedule(context: Context<'schedule.repository'>) {
  const { repository } = context.payload;
  
  logger.info({ repo: repository.full_name }, 'Scheduled repository analysis');
  
  // Trigger autonomous improvement campaigns
  const campaigns = await triggerCampaign({
    repoId: repository.id.toString(),
    repoName: repository.full_name,
    owner: repository.owner.login
  });
  
  // Post summary comment if campaigns were triggered
  if (campaigns.length > 0) {
    const issues = await context.octokit.issues.listForRepo({
      owner: repository.owner.login,
      repo: repository.name,
      state: 'open',
      labels: 'reposentinel-campaign'
    });
    
    // Create issue for campaign tracking
    await context.octokit.issues.create({
      owner: repository.owner.login,
      repo: repository.name,
      title: `🤖 RepoSentinel Improvement Campaign - ${new Date().toISOString().split('T')[0]}`,
      body: formatCampaignSummary(campaigns),
      labels: ['reposentinel-campaign', 'automated']
    });
  }
  
  logger.info({ repo: repository.full_name, campaigns: campaigns.length }, 'Scheduled analysis completed');
}

function formatCampaignSummary(campaigns: any[]): string {
  return `## 🎯 RepoSentinel Improvement Campaigns
  
**Started**: ${new Date().toISOString()}

### Active Campaigns

${campaigns.map(c => `
#### ${c.icon} ${c.name}
- **Goal**: ${c.goal}
- **Target**: ${c.target}
- **Estimated PRs**: ${c.estimatedPRs}
- **Status**: 🔄 In Progress
`).join('\n')}

---

*These campaigns will automatically create PRs as improvements are discovered. Review and merge at your convenience.*

📊 Track progress in the [Dashboard](https://reposentinel.dev/dashboard)
`;
}
