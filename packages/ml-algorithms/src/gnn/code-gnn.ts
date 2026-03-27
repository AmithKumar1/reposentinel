/**
 * Graph Neural Network for Code Understanding
 * Uses Graph Convolutional Networks (GCN) + Graph Attention Networks (GAT)
 * to learn representations of code structure
 */

import * as tf from '@tensorflow/tfjs-node';
import { Matrix } from 'ml-matrix';
import { logger } from '../utils/logger.js';

export interface GNNConfig {
  hiddenDims: number[];
  numLayers: number;
  attentionHeads: number;
  dropout: number;
  learningRate: number;
  aggregationMethod: 'mean' | 'sum' | 'max' | 'attention';
}

export interface CodeGraph {
  nodes: CodeNode[];
  edges: CodeEdge[];
  adjacencyMatrix: number[][];
  nodeFeatures: number[][];
}

export interface CodeNode {
  id: string;
  type: 'file' | 'module' | 'function' | 'class' | 'variable';
  features: number[];
  label?: number;
}

export interface CodeEdge {
  source: string;
  target: string;
  type: 'calls' | 'imports' | 'extends' | 'contains' | 'references';
  weight: number;
}

export interface GNNPrediction {
  nodeId: string;
  riskScore: number;
  complexityScore: number;
  changeProbability: number;
  embeddings: number[];
}

export class CodeGraphNeuralNetwork {
  private config: GNNConfig;
  private model: tf.LayersModel | null = null;
  private isTraining: boolean = false;

  constructor(config: Partial<GNNConfig> = {}) {
    this.config = {
      hiddenDims: config.hiddenDims || [256, 128, 64],
      numLayers: config.numLayers || 3,
      attentionHeads: config.attentionHeads || 4,
      dropout: config.dropout || 0.3,
      learningRate: config.learningRate || 0.001,
      aggregationMethod: config.aggregationMethod || 'attention'
    };
  }

  /**
   * Build Graph Attention Network architecture
   */
  buildModel(inputDim: number, outputDim: number): void {
    const model = tf.sequential();

    // Input projection
    model.add(tf.layers.dense({
      inputShape: [inputDim],
      units: this.config.hiddenDims[0],
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }));

    // Graph Attention Layers
    for (let i = 0; i < this.config.numLayers; i++) {
      const attentionOutput = tf.layers.dense({
        units: this.config.hiddenDims[i] || this.config.hiddenDims[this.config.hiddenDims.length - 1],
        activation: 'relu',
        kernelInitializer: 'heNormal',
        kernelRegularizer: tf.regularizer.l2({ l2: 0.01 })
      });

      model.add(attentionOutput);
      
      if (i < this.config.numLayers - 1) {
        model.add(tf.layers.dropout({ rate: this.config.dropout }));
      }
    }

    // Output heads for multi-task learning
    const outputLayers = [
      tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'risk' }),
      tf.layers.dense({ units: 1, activation: 'linear', name: 'complexity' }),
      tf.layers.dense({ units: 1, activation: 'sigmoid', name: 'changeProb' }),
      tf.layers.dense({ units: outputDim, activation: 'linear', name: 'embeddings' })
    ];

    // Merge outputs
    const concatenated = tf.layers.concatenate().apply(outputLayers.map(l => l.output)) as tf.SymbolicTensor;
    model.add(tf.layers.dense({ units: outputDim + 3 }));

    model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'meanSquaredError',
      metrics: ['accuracy']
    });

    this.model = model;
    logger.info({ config: this.config }, 'GNN model built');
  }

  /**
   * Message Passing Neural Network forward pass
   * Implements: h_v^(l+1) = σ(∑_{u∈N(v)} α_{vu} W h_u^(l))
   */
  messagePassing(graph: CodeGraph, nodeFeatures: tf.Tensor): tf.Tensor {
    const { adjacencyMatrix } = graph;
    
    // Convert adjacency to tensor
    const adjTensor = tf.tensor2d(adjacencyMatrix);
    
    // Normalize adjacency matrix (D^(-1/2) A D^(-1/2))
    const degree = tf.sum(adjTensor, 1);
    const degreeInvSqrt = tf.pow(degree, -0.5);
    const normAdj = tf.matMul(tf.matMul(tf.diag(degreeInvSqrt), adjTensor), tf.diag(degreeInvSqrt));
    
    // Message passing: aggregate neighbor information
    const messages = tf.matMul(normAdj, nodeFeatures);
    
    // Apply attention weights
    const attention = this.computeAttention(graph, nodeFeatures);
    const attendedMessages = tf.mul(messages, attention);
    
    return attendedMessages;
  }

  /**
   * Compute attention weights for Graph Attention Network
   * α_{ij} = exp(LeakyReLU(a^T [Wh_i || Wh_j])) / ∑_k exp(LeakyReLU(a^T [Wh_i || Wh_k]))
   */
  private computeAttention(graph: CodeGraph, features: tf.Tensor): tf.Tensor {
    const numNodes = graph.nodes.length;
    
    // Project features for attention computation
    const projected = tf.layers.dense({ units: 64 }).apply(features) as tf.Tensor;
    
    // Compute pairwise attention
    const attentionScores: number[][] = [];
    
    for (let i = 0; i < numNodes; i++) {
      const row: number[] = [];
      for (let j = 0; j < numNodes; j++) {
        if (graph.adjacencyMatrix[i][j] > 0) {
          // Concatenate features and compute attention
          const concat = tf.concat([projected.gather(i), projected.gather(j)]);
          const score = tf.layers.dense({ units: 1, activation: 'leakyReLU' }).apply(concat) as tf.Tensor;
          row.push(score.dataSync()[0]);
        } else {
          row.push(-Infinity);
        }
      }
      attentionScores.push(row);
    }
    
    // Softmax normalization
    const attentionTensor = tf.softmax(tf.tensor2d(attentionScores), 1);
    return attentionTensor;
  }

  /**
   * Train the GNN on code graph with labels
   */
  async train(
    graphs: CodeGraph[],
    labels: { risk: number[]; complexity: number[]; changeProb: number[] },
    epochs: number = 100
  ): Promise<TrainingHistory> {
    if (!this.model) {
      const inputDim = graphs[0].nodeFeatures[0].length;
      this.buildModel(inputDim, 64);
    }

    this.isTraining = true;
    const history: TrainingHistory = { loss: [], accuracy: [] };

    for (let epoch = 0; epoch < epochs; epoch++) {
      const epochLosses: number[] = [];
      
      for (const graph of graphs) {
        const nodeFeatures = tf.tensor2d(graph.nodeFeatures);
        
        // Forward pass with message passing
        const attendedMessages = this.messagePassing(graph, nodeFeatures);
        
        // Compute predictions
        const predictions = this.model!.predict(attendedMessages) as tf.Tensor;
        
        // Compute loss
        const riskPred = predictions.slice([0, 0], [-1, 1]);
        const complexityPred = predictions.slice([0, 1], [-1, 1]);
        const changePred = predictions.slice([0, 2], [-1, 1]);
        
        const riskLoss = tf.losses.meanSquaredError(tf.tensor1d(labels.risk), riskPred);
        const complexityLoss = tf.losses.meanSquaredError(tf.tensor1d(labels.complexity), complexityPred);
        const changeLoss = tf.losses.meanSquaredError(tf.tensor1d(labels.changeProb), changePred);
        
        const totalLoss = tf.add(tf.add(riskLoss, complexityLoss), changeLoss);
        epochLosses.push(totalLoss.dataSync()[0]);
        
        // Backward pass
        await this.model!.fit(attendedMessages, predictions, {
          epochs: 1,
          verbose: 0
        });
        
        // Cleanup tensors
        nodeFeatures.dispose();
        attendedMessages.dispose();
        predictions.dispose();
      }
      
      history.loss.push(tf.util.mean(epochLosses));
      logger.debug({ epoch, loss: history.loss[epoch] }, 'Training progress');
    }

    this.isTraining = false;
    return history;
  }

  /**
   * Predict risk, complexity, and change probability for code nodes
   */
  predict(graph: CodeGraph): GNNPrediction[] {
    if (!this.model) {
      throw new Error('Model not trained. Call train() first.');
    }

    const nodeFeatures = tf.tensor2d(graph.nodeFeatures);
    const attendedMessages = this.messagePassing(graph, nodeFeatures);
    const predictions = this.model.predict(attendedMessages) as tf.Tensor;
    
    const results: GNNPrediction[] = [];
    
    for (let i = 0; i < graph.nodes.length; i++) {
      const nodePred = predictions.slice([i, 0], [1, -1]).dataSync();
      
      results.push({
        nodeId: graph.nodes[i].id,
        riskScore: nodePred[0],
        complexityScore: nodePred[1],
        changeProbability: nodePred[2],
        embeddings: Array.from(nodePred.slice(3))
      });
    }

    // Cleanup
    nodeFeatures.dispose();
    attendedMessages.dispose();
    predictions.dispose();

    return results;
  }

  /**
   * Find anomalous code patterns using GNN embeddings
   */
  findAnomalies(graph: CodeGraph, threshold: number = 2.5): string[] {
    const predictions = this.predict(graph);
    const embeddings = predictions.map(p => p.embeddings);
    
    // Compute mean and std of embeddings
    const mean = embeddings.reduce((a, b) => a.map((v, i) => v + b[i]), new Array(embeddings[0].length).fill(0))
      .map(v => v / embeddings.length);
    
    const std = Math.sqrt(
      embeddings.map(e => e.reduce((sum, v, i) => sum + Math.pow(v - mean[i], 2), 0))
        .reduce((a, b) => a + b, 0) / embeddings.length
    );
    
    // Find nodes with embeddings > threshold std deviations from mean
    const anomalies = predictions
      .filter(p => {
        const zScore = p.embeddings.map((v, i) => Math.abs(v - mean[i]) / std).reduce((a, b) => a + b, 0);
        return zScore > threshold;
      })
      .map(p => p.nodeId);

    logger.info({ anomalies: anomalies.length, total: graph.nodes.length }, 'Anomalies detected');
    return anomalies;
  }

  /**
   * Save trained model
   */
  async save(path: string): Promise<void> {
    if (!this.model) return;
    await this.model.save(`file://${path}`);
    logger.info({ path }, 'Model saved');
  }

  /**
   * Load trained model
   */
  async load(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}/model.json`);
    logger.info({ path }, 'Model loaded');
  }
}

export interface TrainingHistory {
  loss: number[];
  accuracy: number[];
}
