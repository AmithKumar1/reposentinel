/**
 * RepoSentinel Brain Indexer
 * Parses codebases and builds knowledge graphs
 */

import { CodeParser } from './parser/code-parser.js';
import { GraphBuilder } from './graph/graph-builder.js';
import { EmbeddingEngine } from './embeddings/embedding-engine.js';
import { logger } from './utils/logger.js';
import { ConfigLoader } from './config/config-loader.js';

interface IndexOptions {
  repoPath: string;
  repoId: string;
  repoName: string;
  language?: string;
  incremental?: boolean;
}

export class BrainIndexer {
  private parser: CodeParser;
  private graphBuilder: GraphBuilder;
  private embeddingEngine: EmbeddingEngine;
  private config: ConfigLoader;

  constructor() {
    this.parser = new CodeParser();
    this.graphBuilder = new GraphBuilder();
    this.embeddingEngine = new EmbeddingEngine();
    this.config = new ConfigLoader();
  }

  async index(options: IndexOptions): Promise<IndexResult> {
    const startTime = Date.now();
    
    logger.info({ repo: options.repoName }, 'Starting brain indexing');
    
    // Load repo configuration
    const config = await this.config.load(options.repoPath);
    
    // Parse all files
    const parseResult = await this.parser.parse({
      repoPath: options.repoPath,
      language: options.language || 'typescript',
      exclude: config.exclusions?.paths || []
    });
    
    logger.info({ 
      files: parseResult.files.length,
      functions: parseResult.functions.length,
      classes: parseResult.classes.length
    }, 'Code parsing completed');
    
    // Build knowledge graph
    const graphResult = await this.graphBuilder.build({
      repoId: options.repoId,
      repoName: options.repoName,
      files: parseResult.files,
      functions: parseResult.functions,
      classes: parseResult.classes,
      dependencies: parseResult.dependencies
    });
    
    logger.info({ 
      nodes: graphResult.nodesCreated,
      relationships: graphResult.relationshipsCreated
    }, 'Knowledge graph built');
    
    // Generate embeddings
    const embeddingResult = await this.embeddingEngine.embed({
      repoId: options.repoId,
      functions: parseResult.functions,
      files: parseResult.files
    });
    
    logger.info({ 
      embeddings: embeddingResult.count
    }, 'Embeddings generated');
    
    // Calculate health metrics
    const healthMetrics = await this.calculateHealthMetrics({
      graphResult,
      parseResult
    });
    
    const duration = Date.now() - startTime;
    
    logger.info({ 
      repo: options.repoName,
      duration: `${duration}ms`
    }, 'Brain indexing completed');
    
    return {
      filesIndexed: parseResult.files.length,
      functionsIndexed: parseResult.functions.length,
      classesIndexed: parseResult.classes.length,
      nodesCreated: graphResult.nodesCreated,
      relationshipsCreated: graphResult.relationshipsCreated,
      embeddingsGenerated: embeddingResult.count,
      healthMetrics,
      duration
    };
  }

  private async calculateHealthMetrics(data: any): Promise<HealthMetrics> {
    // Security score based on CodeQL/Semgrep findings
    const securityScore = this.calculateSecurityScore(data);
    
    // Maintainability based on complexity, coupling, duplication
    const maintainabilityScore = this.calculateMaintainabilityScore(data);
    
    // Test coverage from parsed test files
    const testCoverageScore = this.calculateTestCoverage(data);
    
    // Overall weighted score
    const overallScore = (
      securityScore * 0.35 +
      maintainabilityScore * 0.35 +
      testCoverageScore * 0.30
    );
    
    return {
      security: securityScore,
      maintainability: maintainabilityScore,
      testCoverage: testCoverageScore,
      overall: overallScore,
      timestamp: new Date().toISOString()
    };
  }

  private calculateSecurityScore(data: any): number {
    // Placeholder - will be enhanced with actual security analysis
    return 75;
  }

  private calculateMaintainabilityScore(data: any): number {
    const avgComplexity = data.parseResult.functions.reduce((acc: number, f: any) => acc + f.complexity, 0) / data.parseResult.functions.length;
    const complexityPenalty = Math.min(30, avgComplexity * 2);
    return Math.max(0, 100 - complexityPenalty);
  }

  private calculateTestCoverage(data: any): number {
    // Placeholder - will calculate from actual test files
    return 65;
  }
}

export interface IndexResult {
  filesIndexed: number;
  functionsIndexed: number;
  classesIndexed: number;
  nodesCreated: number;
  relationshipsCreated: number;
  embeddingsGenerated: number;
  healthMetrics: HealthMetrics;
  duration: number;
}

export interface HealthMetrics {
  security: number;
  maintainability: number;
  testCoverage: number;
  overall: number;
  timestamp: string;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const indexer = new BrainIndexer();
  const repoPath = process.argv[2] || '.';
  
  indexer.index({
    repoPath,
    repoId: 'cli-run',
    repoName: repoPath.split('/').pop() || 'unknown'
  }).then(result => {
    console.log('✅ Indexing complete:', result);
  }).catch(console.error);
}
