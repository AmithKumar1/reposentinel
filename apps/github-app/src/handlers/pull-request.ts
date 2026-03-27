import { Context } from 'probot';
import { logger } from '../utils/logger.js';
import { analyzePullRequest } from '../services/pr-analysis.js';

export async function handlePullRequest(context: Context<'pull_request'>) {
  const { action, pull_request, repository } = context.payload;
  
  logger.info({ 
    repo: repository.full_name, 
    pr: pull_request.number, 
    action 
  }, 'Pull request event received');
  
  // Only analyze on open/synchronize
  if (!['opened', 'synchronize', 'reopened'].includes(action)) {
    return;
  }
  
  // Add initial comment
  await context.octokit.issues.createComment({
    owner: repository.owner.login,
    repo: repository.name,
    issue_number: pull_request.number,
    body: `## 🔍 RepoSentinel Analysis Started
  
I'm reviewing this PR for:
- 🔒 Security vulnerabilities
- ⚡ Performance issues  
- 🏗️ Architecture concerns
- 📝 Code quality
- 🧪 Test coverage

Analysis in progress...`
  });
  
  // Run analysis
  const analysis = await analyzePullRequest(context);
  
  // Post results as comment
  const comment = formatAnalysisComment(analysis);
  await context.octokit.issues.createComment({
    owner: repository.owner.login,
    repo: repository.name,
    issue_number: pull_request.number,
    body: comment
  });
  
  // Add labels if issues found
  if (analysis.securityIssues.length > 0) {
    await context.octokit.issues.addLabels({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
      labels: ['security-review-needed']
    });
  }
  
  if (analysis.performanceIssues.length > 0) {
    await context.octokit.issues.addLabels({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
      labels: ['performance-review-needed']
    });
  }
  
  logger.info({ 
    repo: repository.full_name, 
    pr: pull_request.number 
  }, 'Pull request analysis completed');
}

function formatAnalysisComment(analysis: any): string {
  const { securityIssues, performanceIssues, codeQuality, suggestions } = analysis;
  
  let comment = `## 🔍 RepoSentinel Analysis Complete\n\n`;
  
  // Security
  if (securityIssues.length > 0) {
    comment += `### 🔒 Security Issues (${securityIssues.length})\n`;
    securityIssues.forEach((issue: any) => {
      comment += `- **${issue.severity.toUpperCase()}**: ${issue.message}\n  \`${issue.location}\`\n`;
    });
    comment += '\n';
  } else {
    comment += `### ✅ No Security Issues\n\n`;
  }
  
  // Performance
  if (performanceIssues.length > 0) {
    comment += `### ⚡ Performance Concerns (${performanceIssues.length})\n`;
    performanceIssues.forEach((issue: any) => {
      comment += `- ${issue.message}\n  \`${issue.location}\`\n`;
    });
    comment += '\n';
  }
  
  // Code Quality Score
  comment += `### 📊 Code Quality\n`;
  comment += `- Overall Score: **${codeQuality.score}/100**\n`;
  comment += `- Maintainability: ${codeQuality.maintainability}\n`;
  comment += `- Test Coverage: ${codeQuality.coverage}%\n\n`;
  
  // Suggestions
  if (suggestions.length > 0) {
    comment += `### 💡 Suggestions\n`;
    suggestions.forEach((s: any, i: number) => {
      comment += `${i + 1}. ${s}\n`;
    });
  }
  
  return comment;
}
