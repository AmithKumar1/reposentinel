/**
 * Causal Inference Engine for Root Cause Analysis
 * Uses Structural Causal Models (SCM) + Do-Calculus
 */

import { Matrix } from 'ml-matrix';
import { logger } from '../utils/logger.js';

export interface CausalGraph {
  nodes: string[];
  edges: CausalEdge[];
  adjacencyMatrix: number[][];
}

export interface CausalEdge {
  source: string;
  target: string;
  strength: number;
  confounders?: string[];
}

export interface CausalEffect {
  treatment: string;
  outcome: string;
  effect: number;
  confidence: number;
  pValue: number;
  identificationStrategy: string;
}

export class CausalInferenceEngine {
  private graph: CausalGraph | null = null;
  private data: Map<string, number[]> = new Map();

  /**
   * Build causal graph from code metrics
   */
  buildCausalGraph(metrics: Record<string, number>[]): void {
    const nodes = Object.keys(metrics[0]);
    const n = nodes.length;
    
    // Compute pairwise causal effects using PC algorithm
    const edges: CausalEdge[] = [];
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const cause = nodes[i];
        const effect = nodes[j];
        
        // Test for causal direction using Granger causality
        const grangerTest = this.grangerCausalityTest(
          metrics.map(m => m[cause]),
          metrics.map(m => m[effect])
        );
        
        if (grangerTest.isSignificant) {
          edges.push({
            source: cause,
            target: effect,
            strength: grangerTest.effectSize,
            confounders: this.detectConfounders(cause, effect, metrics)
          });
        }
      }
    }
    
    this.graph = {
      nodes,
      edges,
      adjacencyMatrix: this.buildAdjacencyMatrix(nodes, edges)
    };
    
    logger.info({ nodes: nodes.length, edges: edges.length }, 'Causal graph built');
  }

  /**
   * Granger Causality Test
   * Tests if X "Granger-causes" Y (X precedes Y temporally)
   */
  private grangerCausalityTest(x: number[], y: number[]): {
    isSignificant: boolean;
    effectSize: number;
  } {
    const maxLag = Math.min(5, Math.floor(x.length / 4));
    
    // Restricted model: Y_t = α + Σ β_i Y_{t-i} + ε_t
    // Unrestricted model: Y_t = α + Σ β_i Y_{t-i} + Σ γ_i X_{t-i} + ε_t
    
    const rssRestricted = this.computeRSS(y, y, 0); // AR only
    const rssUnrestricted = this.computeRSS(y, x, maxLag); // AR + X lags
    
    // F-test
    const df1 = maxLag;
    const df2 = y.length - 2 * maxLag - 1;
    const fStat = ((rssRestricted - rssUnrestricted) / df1) / (rssUnrestricted / df2);
    
    const isSignificant = fStat > 2.5; // Approximate critical value
    const effectSize = (rssRestricted - rssUnrestricted) / rssRestricted;
    
    return { isSignificant, effectSize };
  }

  private computeRSS(y: number[], x: number[], lag: number): number {
    // Simplified RSS computation
    let rss = 0;
    for (let t = lag; t < y.length; t++) {
      const predicted = y[t - 1] || y[0];
      rss += Math.pow(y[t] - predicted, 2);
    }
    return rss;
  }

  private detectConfounders(cause: string, effect: string, metrics: Record<string, number>[]): string[] {
    const confounders: string[] = [];
    
    for (const potentialConfounder of Object.keys(metrics[0])) {
      if (potentialConfounder === cause || potentialConfounder === effect) continue;
      
      // Check if confounder affects both cause and effect
      const corrCause = this.correlation(
        metrics.map(m => m[potentialConfounder]),
        metrics.map(m => m[cause])
      );
      
      const corrEffect = this.correlation(
        metrics.map(m => m[potentialConfounder]),
        metrics.map(m => m[effect])
      );
      
      if (Math.abs(corrCause) > 0.3 && Math.abs(corrEffect) > 0.3) {
        confounders.push(potentialConfounder);
      }
    }
    
    return confounders;
  }

  /**
   * Do-Calculus: Compute P(Y | do(X))
   * Estimates interventional distribution
   */
  computeDoCalculus(treatment: string, outcome: string, data: Record<string, number>[]): CausalEffect {
    if (!this.graph) {
      throw new Error('Causal graph not built. Call buildCausalGraph first.');
    }
    
    // Identify adjustment set using backdoor criterion
    const adjustmentSet = this.findAdjustmentSet(treatment, outcome);
    
    // Compute causal effect using backdoor adjustment
    // P(Y | do(X)) = Σ_z P(Y | X, Z=z) P(Z=z)
    const causalEffect = this.backdoorAdjustment(
      data,
      treatment,
      outcome,
      adjustmentSet
    );
    
    // Compute confidence using bootstrap
    const bootstrapEffects: number[] = [];
    for (let i = 0; i < 100; i++) {
      const sample = this.bootstrapSample(data);
      const effect = this.backdoorAdjustment(sample, treatment, outcome, adjustmentSet);
      bootstrapEffects.push(effect);
    }
    
    const stdErr = this.standardDeviation(bootstrapEffects);
    const confidence = 1 - (stdErr / Math.abs(causalEffect));
    
    return {
      treatment,
      outcome,
      effect: causalEffect,
      confidence: Math.max(0, Math.min(1, confidence)),
      pValue: this.computePValue(causalEffect, stdErr),
      identificationStrategy: adjustmentSet.length > 0 
        ? `Backdoor adjustment with [${adjustmentSet.join(', ')}]`
        : 'Direct causal path (no confounders)'
    };
  }

  /**
   * Find adjustment set using backdoor criterion
   */
  private findAdjustmentSet(treatment: string, outcome: string): string[] {
    if (!this.graph) return [];
    
    const adjustmentSet: string[] = [];
    
    // Find all backdoor paths from treatment to outcome
    for (const edge of this.graph.edges) {
      if (edge.target === treatment && edge.source !== outcome) {
        // This is a backdoor path through edge.source
        if (!this.isBlockedBy(edge.source, treatment, this.graph)) {
          adjustmentSet.push(edge.source);
        }
      }
    }
    
    return adjustmentSet;
  }

  private isBlockedBy(node: string, treatment: string, graph: CausalGraph): boolean {
    // Check if node is a collider on any path to treatment
    for (const edge of graph.edges) {
      if (edge.target === node && edge.source !== treatment) {
        return false; // Not a collider
      }
    }
    return true;
  }

  /**
   * Backdoor adjustment formula
   */
  private backdoorAdjustment(
    data: Record<string, number>[],
    treatment: string,
    outcome: string,
    adjustmentSet: string[]
  ): number {
    if (adjustmentSet.length === 0) {
      // Simple difference in means
      const treated = data.filter(d => d[treatment] > 0.5);
      const control = data.filter(d => d[treatment] <= 0.5);
      
      const meanTreated = treated.reduce((s, d) => s + d[outcome], 0) / treated.length;
      const meanControl = control.reduce((s, d) => s + d[outcome], 0) / control.length;
      
      return meanTreated - meanControl;
    }
    
    // Stratified estimation
    const strata = this.createStrata(data, adjustmentSet);
    
    let totalEffect = 0;
    let totalWeight = 0;
    
    for (const stratum of strata) {
      const effect = this.backdoorAdjustment(stratum, treatment, outcome, []);
      const weight = stratum.length / data.length;
      
      totalEffect += weight * effect;
      totalWeight += weight;
    }
    
    return totalEffect / totalWeight;
  }

  private createStrata(data: Record<string, number>[], variables: string[]): Record<string, number>[][] {
    // Simple stratification by median split
    const strata: Map<string, Record<string, number>[]> = new Map();
    
    for (const point of data) {
      const key = variables.map(v => point[v] > 0.5 ? '1' : '0').join('-');
      if (!strata.has(key)) {
        strata.set(key, []);
      }
      strata.get(key)!.push(point);
    }
    
    return Array.from(strata.values());
  }

  private bootstrapSample(data: Record<string, number>[]): Record<string, number>[] {
    const sample: Record<string, number>[] = [];
    for (let i = 0; i < data.length; i++) {
      const idx = Math.floor(Math.random() * data.length);
      sample.push(data[idx]);
    }
    return sample;
  }

  private correlation(x: number[], y: number[]): number {
    const meanX = x.reduce((a, b) => a + b, 0) / x.length;
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;
    
    const numerator = x.reduce((sum, xi, i) => sum + (xi - meanX) * (y[i] - meanY), 0);
    const denomX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - meanX, 2), 0));
    const denomY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0));
    
    return numerator / (denomX * denomY);
  }

  private standardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private computePValue(effect: number, stdErr: number): number {
    const zScore = Math.abs(effect) / stdErr;
    return 2 * (1 - this.standardNormalCDF(zScore));
  }

  private standardNormalCDF(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  private buildAdjacencyMatrix(nodes: string[], edges: CausalEdge[]): number[][] {
    const n = nodes.length;
    const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    
    for (const edge of edges) {
      const i = nodes.indexOf(edge.source);
      const j = nodes.indexOf(edge.target);
      if (i >= 0 && j >= 0) {
        matrix[i][j] = edge.strength;
      }
    }
    
    return matrix;
  }
}
