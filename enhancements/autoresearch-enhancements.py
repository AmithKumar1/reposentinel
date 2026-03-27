"""
Advanced ML/AI Enhancements for Karpathy's autoresearch
Implements: Bayesian Optimization, Early Stopping, Multi-Objective Search
"""

import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, ConstantKernel as C
from scipy.optimize import minimize
from scipy.stats import norm
import torch
import time


@dataclass
class ArchitectureConfig:
    """Neural architecture configuration."""
    n_layer: int = 8
    n_head: int = 6
    n_kv_head: int = 6
    n_embd: int = 768
    sequence_len: int = 2048
    vocab_size: int = 32768
    window_pattern: str = "SSSL"
    
    def to_dict(self):
        return {
            'n_layer': self.n_layer,
            'n_head': self.n_head,
            'n_kv_head': self.n_kv_head,
            'n_embd': self.n_embd,
            'sequence_len': self.sequence_len,
            'vocab_size': self.vocab_size,
            'window_pattern': self.window_pattern
        }
    
    @classmethod
    def from_dict(cls, d):
        return cls(**d)


class BayesianArchitectureOptimizer:
    """
    Bayesian Optimization for neural architecture search.
    Uses Gaussian Process surrogate model + Expected Improvement acquisition.
    """
    
    def __init__(self, param_bounds: Optional[Dict] = None):
        self.param_bounds = param_bounds or {
            'n_layer': (4, 16),
            'n_head': (4, 12),
            'n_kv_head': (2, 8),
            'n_embd': (256, 1024),
            'sequence_len': (512, 4096),
            'vocab_size': (8192, 65536)
        }
        
        # Initialize GP with Matern kernel (better for non-smooth functions)
        kernel = C(1.0) * Matern(length_scale=1.0, nu=2.5)
        self.gp = GaussianProcessRegressor(
            kernel=kernel,
            n_restarts_optimizer=10,
            normalize_y=True
        )
        
        self.experiment_history: List[Tuple[ArchitectureConfig, float]] = []
        self.best_config: Optional[ArchitectureConfig] = None
        self.best_val_bpb: float = float('inf')
    
    def encode_config(self, config: ArchitectureConfig) -> np.ndarray:
        """Normalize config to [0, 1] range for GP."""
        encoded = []
        for param, (low, high) in self.param_bounds.items():
            value = getattr(config, param, None)
            if value is None:
                continue
            # Normalize to [0, 1]
            normalized = (value - low) / (high - low)
            encoded.append(np.clip(normalized, 0, 1))
        return np.array(encoded)
    
    def decode_config(self, encoded: np.ndarray) -> ArchitectureConfig:
        """Decode normalized vector back to config."""
        params = {}
        for i, (param, (low, high)) in enumerate(self.param_bounds.items()):
            if i >= len(encoded):
                break
            # Denormalize
            value = encoded[i] * (high - low) + low
            # Round to integer for discrete params
            if param in ['n_layer', 'n_head', 'n_kv_head', 'sequence_len', 'vocab_size']:
                value = int(round(value))
            params[param] = value
        
        # Handle categorical (window_pattern)
        patterns = ["SSSL", "SSS", "SSL", "SL", "L"]
        if 'window_pattern' in self.param_bounds:
            idx = int(encoded[-1] * len(patterns)) % len(patterns)
            params['window_pattern'] = patterns[idx]
        
        return ArchitectureConfig.from_dict(params)
    
    def expected_improvement(self, encoded: np.ndarray) -> float:
        """Expected Improvement acquisition function."""
        if len(self.experiment_history) == 0:
            return 0.0
        
        encoded = encoded.reshape(1, -1)
        mu, sigma = self.gp.predict(encoded, return_std=True)
        
        # EI = (f_best - mu) * Φ(Z) + σ * φ(Z), where Z = (f_best - μ) / σ
        with np.errstate(divide='ignore'):
            Z = (self.best_val_bpb - mu) / sigma
            ei = (self.best_val_bpb - mu) * norm.cdf(Z) + sigma * norm.pdf(Z)
        
        return -ei.item()  # Minimize negative EI
    
    def suggest_next_config(self) -> ArchitectureConfig:
        """Suggest next architecture to evaluate."""
        if len(self.experiment_history) == 0:
            # Random initial configuration
            return self._random_config()
        
        # Optimize acquisition function
        result = minimize(
            self.expected_improvement,
            x0=self.encode_config(self.best_config),
            bounds=[(0, 1)] * len(self.param_bounds),
            method='L-BFGS-B',
            options={'maxiter': 100}
        )
        
        return self.decode_config(result.x)
    
    def _random_config(self) -> ArchitectureConfig:
        """Generate random configuration within bounds."""
        params = {}
        for param, (low, high) in self.param_bounds.items():
            if param == 'window_pattern':
                patterns = ["SSSL", "SSS", "SSL", "SL", "L"]
                params[param] = np.random.choice(patterns)
            elif param in ['n_layer', 'n_head', 'n_kv_head', 'sequence_len', 'vocab_size']:
                params[param] = np.random.randint(low, high + 1)
            else:
                params[param] = np.random.uniform(low, high)
        
        return ArchitectureConfig.from_dict(params)
    
    def update(self, config: ArchitectureConfig, val_bpb: float):
        """Update GP with new observation."""
        self.experiment_history.append((config, val_bpb))
        
        if val_bpb < self.best_val_bpb:
            self.best_val_bpb = val_bpb
            self.best_config = config
        
        # Retrain GP
        X = np.array([self.encode_config(c) for c, _ in self.experiment_history])
        y = np.array([bpb for _, bpb in self.experiment_history])
        
        self.gp.fit(X, y)
    
    def get_confidence_interval(self, config: ArchitectureConfig, alpha: float = 0.95) -> Tuple[float, float]:
        """Get confidence interval for predicted val_bpb."""
        encoded = self.encode_config(config).reshape(1, -1)
        mu, sigma = self.gp.predict(encoded, return_std=True)
        
        z = norm.ppf((1 + alpha) / 2)
        lower = mu - z * sigma
        upper = mu + z * sigma
        
        return lower.item(), upper.item()


class AdaptiveScheduler:
    """
    Multi-fidelity optimization with early stopping.
    Implements Hyperband-style resource allocation.
    """
    
    def __init__(self, min_budget: int = 30, max_budget: int = 300, eta: int = 3):
        self.min_budget = min_budget  # 30 seconds
        self.max_budget = max_budget  # 300 seconds (5 minutes)
        self.eta = eta  # Reduction factor
        self.loss_history: Dict[str, List[float]] = {}
    
    def should_continue(self, config_id: str, elapsed: float, current_bpb: float) -> bool:
        """Decide whether to continue training or early stop."""
        if config_id not in self.loss_history:
            self.loss_history[config_id] = []
        
        self.loss_history[config_id].append(current_bpb)
        
        # Predict final performance
        predicted_final = self._predict_final_performance(config_id, elapsed)
        
        # Get percentile threshold
        all_predictions = [
            self._predict_final_performance(cid, self.min_budget)
            for cid in self.loss_history.keys()
            if len(self.loss_history[cid]) >= 3
        ]
        
        if len(all_predictions) == 0:
            return True
        
        threshold = np.percentile(all_predictions, 100 * (1 - 1/self.eta))
        
        # Continue if in top 1/eta
        return predicted_final < threshold
    
    def _predict_final_performance(self, config_id: str, elapsed: float) -> float:
        """Predict final val_bpb using learning curve model."""
        if config_id not in self.loss_history or len(self.loss_history[config_id]) < 3:
            return self.loss_history.get(config_id, [float('inf')])[-1]
        
        # Fit power law: L(t) = L_inf + A * t^(-alpha)
        from scipy.optimize import curve_fit
        
        def power_law(t, L_inf, A, alpha):
            return L_inf + A * (t ** (-alpha))
        
        t_obs = np.arange(self.min_budget // 10, elapsed + 1, self.min_budget // 10)
        bpb_obs = self.loss_history[config_id][:len(t_obs)]
        
        if len(t_obs) < 3 or len(bpb_obs) < 3:
            return bpb_obs[-1] if bpb_obs else float('inf')
        
        try:
            params, _ = curve_fit(
                power_law, t_obs, bpb_obs,
                p0=[bpb_obs[-1], 1.0, 0.5],
                bounds=([0, 0, 0], [np.inf, np.inf, 2])
            )
            return power_law(self.max_budget, *params)
        except:
            return bpb_obs[-1]
    
    def get_allocated_budget(self, config_id: str, initial_bpb: float) -> int:
        """Get allocated training budget for configuration."""
        # Initial allocation
        return self.min_budget


class MultiObjectiveOptimizer:
    """
    NSGA-II based multi-objective architecture search.
    Optimizes: val_bpb, parameter count, inference latency
    """
    
    def __init__(self, population_size: int = 20):
        self.pop_size = population_size
        self.population: List[ArchitectureConfig] = []
        self.pareto_front: List[ArchitectureConfig] = []
        self.fitness_history: List[Dict] = []
    
    def initialize_population(self):
        """Initialize random population."""
        self.population = [
            ArchitectureConfig(
                n_layer=np.random.randint(4, 16),
                n_head=np.random.randint(4, 12),
                n_kv_head=np.random.randint(2, 8),
                n_embd=np.random.randint(256, 1024),
                sequence_len=np.random.randint(512, 4096),
                vocab_size=np.random.randint(8192, 65536),
                window_pattern=np.random.choice(["SSSL", "SSS", "SSL", "SL", "L"])
            )
            for _ in range(self.pop_size)
        ]
    
    def evaluate_fitness(self, config: ArchitectureConfig) -> Dict[str, float]:
        """Multi-objective fitness evaluation."""
        # These would be obtained from actual training
        # For now, using proxy metrics
        
        val_bpb = self._estimate_val_bpb(config)
        params_millions = self._count_parameters(config) / 1e6
        latency_ms = self._estimate_latency(config)
        
        return {
            'val_bpb': val_bpb,
            'params': params_millions,
            'latency': latency_ms
        }
    
    def _count_parameters(self, config: ArchitectureConfig) -> int:
        """Estimate parameter count."""
        # Transformer parameter count approximation
        embd_params = config.n_embd * config.vocab_size  # Embeddings
        attn_params = config.n_layer * (
            4 * config.n_embd * config.n_embd  # Q, K, V, O projections
        )
        mlp_params = config.n_layer * (
            2 * config.n_embd * 4 * config.n_embd  # MLP (4x expansion)
        )
        return embd_params + attn_params + mlp_params
    
    def _estimate_val_bpb(self, config: ArchitectureConfig) -> float:
        """Rough estimate of val_bpb (would come from training)."""
        # Simple heuristic: larger models → lower bpb (with diminishing returns)
        base_bpb = 1.5
        size_factor = np.log(config.n_layer * config.n_embd / 1000)
        return max(0.8, base_bpb - 0.1 * size_factor)
    
    def _estimate_latency(self, config: ArchitectureConfig) -> float:
        """Estimate inference latency in ms."""
        # Rough FLOPs-based estimate
        flops = config.n_layer * (
            2 * config.sequence_len * (config.n_embd ** 2)  # Attention
            + 4 * config.sequence_len * (config.n_embd ** 2)  # MLP
        )
        # Assume 10 TFLOPs GPU
        latency_ms = (flops / 1e13) * 1000
        return latency_ms
    
    def dominates(self, fit1: Dict, fit2: Dict) -> bool:
        """Check if fit1 dominates fit2 (all objectives minimized)."""
        better_in_one = False
        for key in fit1:
            if fit1[key] > fit2[key]:
                return False
            if fit1[key] < fit2[key]:
                better_in_one = True
        return better_in_one
    
    def fast_non_dominated_sort(self, fitness_values: List[Dict]) -> List[List[int]]:
        """NSGA-II non-dominated sorting."""
        n = len(fitness_values)
        domination_count = [0] * n
        dominated_solutions = [[] for _ in range(n)]
        fronts = [[]]
        
        for i in range(n):
            for j in range(i + 1, n):
                if self.dominates(fitness_values[i], fitness_values[j]):
                    dominated_solutions[i].append(j)
                    domination_count[j] += 1
                elif self.dominates(fitness_values[j], fitness_values[i]):
                    dominated_solutions[j].append(i)
                    domination_count[i] += 1
            
            if domination_count[i] == 0:
                fronts[0].append(i)
        
        current_front = 0
        while fronts[current_front]:
            next_front = []
            for i in fronts[current_front]:
                for j in dominated_solutions[i]:
                    domination_count[j] -= 1
                    if domination_count[j] == 0:
                        next_front.append(j)
            current_front += 1
            if next_front:
                fronts.append(next_front)
        
        return fronts
    
    def assign_crowding_distance(self, fronts: List[List[int]], fitness_values: List[Dict]):
        """Assign crowding distance for diversity preservation."""
        self.crowding_distances = [0.0] * len(fitness_values)
        
        for front in fronts:
            if len(front) <= 2:
                for i in front:
                    self.crowding_distances[i] = float('inf')
                continue
            
            # Sort by each objective
            for obj in fitness_values[0].keys():
                sorted_front = sorted(front, key=lambda i: fitness_values[i][obj])
                
                # Boundary points get infinite distance
                self.crowding_distances[sorted_front[0]] = float('inf')
                self.crowding_distances[sorted_front[-1]] = float('inf')
                
                # Interior points
                obj_range = fitness_values[sorted_front[-1]][obj] - fitness_values[sorted_front[0]][obj]
                if obj_range > 0:
                    for i in range(1, len(sorted_front) - 1):
                        self.crowding_distances[sorted_front[i]] += (
                            fitness_values[sorted_front[i + 1]][obj] - 
                            fitness_values[sorted_front[i - 1]][obj]
                        ) / obj_range
    
    def select_next_generation(self, offspring: List[ArchitectureConfig], 
                               offspring_fitness: List[Dict]) -> List[ArchitectureConfig]:
        """Select next generation using NSGA-II."""
        # Combine parent and offspring
        combined = self.population + offspring
        combined_fitness = [self.evaluate_fitness(c) for c in combined]
        
        # Non-dominated sorting
        fronts = self.fast_non_dominated_sort(combined_fitness)
        
        # Select next generation
        new_population = []
        front_idx = 0
        
        while len(new_population) + len(fronts[front_idx]) <= self.pop_size:
            self.assign_crowding_distance([fronts[front_idx]], combined_fitness)
            new_population.extend([combined[i] for i in fronts[front_idx]])
            front_idx += 1
        
        # Fill remaining with crowding distance
        if len(new_population) < self.pop_size and front_idx < len(fronts):
            self.assign_crowding_distance([fronts[front_idx]], combined_fitness)
            remaining_indices = sorted(
                fronts[front_idx],
                key=lambda i: self.crowding_distances[i],
                reverse=True
            )
            needed = self.pop_size - len(new_population)
            new_population.extend([combined[i] for i in remaining_indices[:needed]])
        
        self.population = new_population
        self.pareto_front = [combined[i] for i in fronts[0]]
        
        return self.population


# Example usage
if __name__ == "__main__":
    # Bayesian Optimization
    print("=" * 60)
    print("Bayesian Architecture Optimization Demo")
    print("=" * 60)
    
    optimizer = BayesianArchitectureOptimizer()
    
    for iteration in range(10):
        config = optimizer.suggest_next_config()
        
        # Simulate training (replace with actual training)
        val_bpb = optimizer._estimate_val_bpb(config) + np.random.normal(0, 0.05)
        
        optimizer.update(config, val_bpb)
        
        print(f"Iteration {iteration + 1}: val_bpb={val_bpb:.4f}, "
              f"layers={config.n_layer}, embd={config.n_embd}")
        
        if optimizer.best_config:
            print(f"  Best so far: {optimizer.best_val_bpb:.4f}")
    
    print("\n" + "=" * 60)
    print(f"Final Best: val_bpb={optimizer.best_val_bpb:.4f}")
    print(f"Config: layers={optimizer.best_config.n_layer}, "
          f"embd={optimizer.best_config.n_embd}, heads={optimizer.best_config.n_head}")
