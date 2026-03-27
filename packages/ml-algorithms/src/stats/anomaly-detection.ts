/**
 * Statistical Anomaly Detection for Code
 * Uses Multiple Statistical Tests + Machine Learning Ensemble
 */

import { Matrix, Stat } from 'ml-matrix';
import { logger } from '../utils/logger.js';

export interface AnomalyResult {
  nodeId: string;
  anomalyScore: number;
  pValue: number;
  testResults: StatisticalTestResult[];
  isAnomaly: boolean;
  confidence: number;
  explanation: string;
}

export interface StatisticalTestResult {
  testName: string;
  statistic: number;
  pValue: number;
  isSignificant: boolean;
}

export interface CodeMetrics {
  nodeId: string;
  loc: number;
  complexity: number;
  coupling: number;
  cohesion: number;
  churn: number;
  testCoverage: number;
  bugCount: number;
  age: number;
  authorCount: number;
}

export class StatisticalAnomalyDetector {
  private baselineMetrics: CodeMetrics[] = [];
  private significanceLevel: number = 0.05;
  private ensembleWeights: Map<string, number> = new Map();

  constructor(significanceLevel: number = 0.05) {
    this.significanceLevel = significanceLevel;
    this.initializeEnsembleWeights();
  }

  private initializeEnsembleWeights(): void {
    // Initialize weights for different statistical tests
    this.ensembleWeights.set('zscore', 0.15);
    this.ensembleWeights.set('iqr', 0.15);
    this.ensembleWeights.set('dbscan', 0.20);
    this.ensembleWeights.set('isolation_forest', 0.25);
    this.ensembleWeights.set('grubbs', 0.15);
    this.ensembleWeights.set('esd', 0.10);
  }

  /**
   * Detect anomalies using ensemble of statistical tests
   */
  detectAnomalies(metrics: CodeMetrics[], baseline?: CodeMetrics[]): AnomalyResult[] {
    const data = baseline || this.baselineMetrics;
    
    if (data.length === 0) {
      logger.warn('No baseline data. Using unsupervised detection.');
      return this.unsupervisedDetection(metrics);
    }

    const results: AnomalyResult[] = [];

    for (const metric of metrics) {
      const testResults = this.runStatisticalTests(metric, data);
      const anomalyScore = this.computeEnsembleScore(testResults);
      const pValue = this.computeCombinedPValue(testResults);
      
      const result: AnomalyResult = {
        nodeId: metric.nodeId,
        anomalyScore,
        pValue,
        testResults,
        isAnomaly: anomalyScore > 0.5,
        confidence: 1 - pValue,
        explanation: this.generateExplanation(testResults, metric)
      };

      results.push(result);
    }

    return results;
  }

  /**
   * Run multiple statistical tests
   */
  private runStatisticalTests(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult[] {
    return [
      this.zScoreTest(metric, baseline),
      this.iqrTest(metric, baseline),
      this.grubbsTest(metric, baseline),
      this.esdTest(metric, baseline),
      this.mahalanobisTest(metric, baseline)
    ];
  }

  /**
   * Z-Score Test for univariate anomalies
   * H0: x comes from the same distribution as baseline
   */
  private zScoreTest(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult {
    const features = ['complexity', 'coupling', 'churn', 'loc'];
    const zScores: number[] = [];

    for (const feature of features) {
      const values = baseline.map(m => (m as any)[feature]);
      const mean = Stat.mean(Matrix.columnVector(values));
      const std = Stat.std(Matrix.columnVector(values));
      
      const zScore = std > 0 ? Math.abs((metric as any)[feature] - mean) / std : 0;
      zScores.push(zScore);
    }

    const maxZ = Math.max(...zScores);
    // Two-tailed p-value from standard normal
    const pValue = 2 * (1 - this.standardNormalCDF(maxZ));

    return {
      testName: 'Z-Score Test',
      statistic: maxZ,
      pValue,
      isSignificant: pValue < this.significanceLevel
    };
  }

  /**
   * Interquartile Range (IQR) Test
   * Detects outliers using robust statistics
   */
  private iqrTest(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult {
    const features = ['complexity', 'coupling', 'churn'];
    let outlierCount = 0;

    for (const feature of features) {
      const values = baseline.map(m => (m as any)[feature]).sort((a, b) => a - b);
      const q1 = this.percentile(values, 25);
      const q3 = this.percentile(values, 75);
      const iqr = q3 - q1;
      
      const lowerBound = q1 - 1.5 * iqr;
      const upperBound = q3 + 1.5 * iqr;
      
      const value = (metric as any)[feature];
      if (value < lowerBound || value > upperBound) {
        outlierCount++;
      }
    }

    const statistic = outlierCount / features.length;
    const pValue = 1 - statistic;

    return {
      testName: 'IQR Test',
      statistic,
      pValue,
      isSignificant: statistic > 0.5
    };
  }

  /**
   * Grubbs' Test for single outlier
   * Tests if max/min value is an outlier
   */
  private grubbsTest(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult {
    const complexities = [...baseline.map(m => m.complexity), metric.complexity];
    const mean = Stat.mean(Matrix.columnVector(complexities));
    const std = Stat.std(Matrix.columnVector(complexities));
    
    const G = Math.max(
      Math.abs(Math.max(...complexities) - mean) / std,
      Math.abs(Math.min(...complexities) - mean) / std
    );

    const n = complexities.length;
    // Critical value approximation for Grubbs' test
    const tCritical = this.tDistributionCriticalValue(1 - this.significanceLevel / (2 * n), n - 2);
    const GCritical = ((n - 1) / Math.sqrt(n)) * Math.sqrt(tCritical * tCritical / (n - 2 + tCritical * tCritical));

    return {
      testName: "Grubbs' Test",
      statistic: G,
      pValue: G > GCritical ? 0.01 : 0.5,
      isSignificant: G > GCritical
    };
  }

  /**
   * ESD (Extreme Studentized Deviate) Test
   * Generalization of Grubbs' test for multiple outliers
   */
  private esdTest(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult {
    const values = [...baseline.map(m => m.complexity), metric.complexity];
    const n = values.length;
    const r = Math.min(5, Math.floor(n / 10)); // Test up to r outliers

    let outliers = 0;
    let remainingValues = [...values];

    for (let i = 0; i < r; i++) {
      const mean = Stat.mean(Matrix.columnVector(remainingValues));
      const std = Stat.std(Matrix.columnVector(remainingValues));
      
      if (std === 0) break;

      const deviations = remainingValues.map(v => Math.abs(v - mean) / std);
      const maxDev = Math.max(...deviations);
      const maxIndex = deviations.indexOf(maxDev);

      // Critical value for ESD
      const lambda = this.esdCriticalValue(n - i, this.significanceLevel);
      
      if (maxDev > lambda) {
        outliers++;
        remainingValues.splice(maxIndex, 1);
      } else {
        break;
      }
    }

    return {
      testName: 'ESD Test',
      statistic: outliers / r,
      pValue: outliers > 0 ? 0.05 : 1.0,
      isSignificant: outliers > 0
    };
  }

  /**
   * Mahalanobis Distance Test for multivariate anomalies
   */
  private mahalanobisTest(metric: CodeMetrics, baseline: CodeMetrics[]): StatisticalTestResult {
    const features = ['loc', 'complexity', 'coupling', 'cohesion', 'churn'];
    
    // Build covariance matrix from baseline
    const baselineMatrix = Matrix.from2DArray(
      baseline.map(m => features.map(f => (m as any)[f]))
    );
    
    const meanVector = baselineMatrix.mean('byColumn');
    const centered = baselineMatrix.sub(meanVector);
    const covMatrix = centered.mmul(centered.transpose()).div(baseline.length - 1);
    
    // Compute Mahalanobis distance
    const metricVector = Matrix.rowVector(features.map(f => (metric as any)[f]));
    const diff = metricVector.sub(meanVector);
    
    // D^2 = (x - μ)^T Σ^(-1) (x - μ)
    const covInv = covMatrix.inverse();
    const mahalanobisDist = Math.sqrt(
      diff.mmul(covInv).mmul(diff.transpose()).get(0, 0)
    );

    // P-value from chi-squared distribution with k degrees of freedom
    const k = features.length;
    const pValue = 1 - this.chiSquaredCDF(mahalanobisDist * mahalanobisDist, k);

    return {
      testName: 'Mahalanobis Distance Test',
      statistic: mahalanobisDist,
      pValue,
      isSignificant: pValue < this.significanceLevel
    };
  }

  /**
   * Compute ensemble anomaly score from test results
   */
  private computeEnsembleScore(testResults: StatisticalTestResult[]): number {
    let weightedScore = 0;
    let totalWeight = 0;

    for (const test of testResults) {
      const weight = this.ensembleWeights.get(test.testName.toLowerCase().replace(' test', '')) || 0.1;
      const score = test.isSignificant ? 1 : 0;
      weightedScore += weight * score;
      totalWeight += weight;
    }

    return weightedScore / totalWeight;
  }

  /**
   * Compute combined p-value using Fisher's method
   */
  private computeCombinedPValue(testResults: StatisticalTestResult[]): number {
    // Fisher's method: χ² = -2 Σ ln(p_i)
    const chiSquared = -2 * testResults.reduce((sum, test) => sum + Math.log(test.pValue), 0);
    
    // Combined p-value from chi-squared with 2k degrees of freedom
    const df = 2 * testResults.length;
    return 1 - this.chiSquaredCDF(chiSquared, df);
  }

  /**
   * Unsupervised anomaly detection when no baseline exists
   */
  private unsupervisedDetection(metrics: CodeMetrics[]): AnomalyResult[] {
    // Use DBSCAN-like approach
    const results: AnomalyResult[] = [];
    
    for (const metric of metrics) {
      // Compute local outlier factor
      const lof = this.computeLocalOutlierFactor(metric, metrics);
      
      results.push({
        nodeId: metric.nodeId,
        anomalyScore: Math.max(0, lof - 1),
        pValue: 1 / lof,
        testResults: [],
        isAnomaly: lof > 1.5,
        confidence: 1 - 1 / lof,
        explanation: `Local Outlier Factor: ${lof.toFixed(2)}`
      });
    }

    return results;
  }

  /**
   * Compute Local Outlier Factor
   */
  private computeLocalOutlierFactor(point: CodeMetrics, allPoints: CodeMetrics[]): number {
    const k = Math.min(10, allPoints.length - 1);
    
    // Find k-nearest neighbors
    const distances = allPoints
      .filter(p => p.nodeId !== point.nodeId)
      .map(p => ({
        id: p.nodeId,
        distance: this.euclideanDistance(point, p)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);

    const kDistance = distances[k - 1]?.distance || 0;
    
    // Compute local reachability density
    const lrd = 1 / (distances.reduce((sum, d) => sum + Math.max(kDistance, d.distance), 0) / k);
    
    // Compute LOF
    const neighborLrds = distances.map(d => {
      const neighbor = allPoints.find(p => p.nodeId === d.id)!;
      return 1 / (this.computeKDistance(neighbor, allPoints, k) || 1);
    });
    
    const avgNeighborLrd = neighborLrds.reduce((a, b) => a + b, 0) / k;
    
    return avgNeighborLrd / lrd;
  }

  private computeKDistance(point: CodeMetrics, allPoints: CodeMetrics[], k: number): number {
    const distances = allPoints
      .filter(p => p.nodeId !== point.nodeId)
      .map(p => this.euclideanDistance(point, p))
      .sort((a, b) => a - b);
    
    return distances[k - 1] || 0;
  }

  private euclideanDistance(a: CodeMetrics, b: CodeMetrics): number {
    const features = ['loc', 'complexity', 'coupling', 'churn'];
    return Math.sqrt(
      features.reduce((sum, f) => sum + Math.pow((a as any)[f] - (b as any)[f], 2), 0)
    );
  }

  /**
   * Generate human-readable explanation
   */
  private generateExplanation(testResults: StatisticalTestResult[], metric: CodeMetrics): string {
    const significantTests = testResults.filter(t => t.isSignificant);
    
    if (significantTests.length === 0) {
      return 'No statistical anomalies detected';
    }

    const explanations: string[] = [];
    
    for (const test of significantTests) {
      if (test.testName.includes('Z-Score')) {
        explanations.push(`Extreme values detected (z-score: ${test.statistic.toFixed(2)})`);
      } else if (test.testName.includes('IQR')) {
        explanations.push('Values outside normal range (IQR method)');
      } else if (test.testName.includes('Grubbs')) {
        explanations.push(`Potential outlier detected (G: ${test.statistic.toFixed(2)})`);
      } else if (test.testName.includes('Mahalanobis')) {
        explanations.push(`Multivariate anomaly (D²: ${test.statistic.toFixed(2)})`);
      }
    }

    return explanations.join('; ');
  }

  // Statistical helper functions
  private standardNormalCDF(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);
    
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return sign * y;
  }

  private tDistributionCriticalValue(p: number, df: number): number {
    // Approximation using normal distribution for large df
    if (df > 30) {
      return this.inverseNormalCDF(p);
    }
    // Simplified approximation
    return 1.96;
  }

  private inverseNormalCDF(p: number): number {
    if (p >= 0.975) return 1.96;
    if (p >= 0.995) return 2.576;
    return 1.645;
  }

  private esdCriticalValue(n: number, alpha: number): number {
    // Approximation for ESD critical value
    return 3.5; // Simplified
  }

  private chiSquaredCDF(x: number, df: number): number {
    // Regularized gamma function approximation
    return 1 - Math.exp(-x / 2); // Simplified
  }

  private percentile(sortedValues: number[], p: number): number {
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedValues[lower];
    }
    
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Set baseline metrics for future comparisons
   */
  setBaseline(metrics: CodeMetrics[]): void {
    this.baselineMetrics = metrics;
    logger.info({ count: metrics.length }, 'Baseline metrics set');
  }
}
