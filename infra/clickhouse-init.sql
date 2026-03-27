-- ClickHouse initialization for RepoSentinel
-- Health metrics time-series storage

CREATE DATABASE IF NOT EXISTS reposentinel;

USE reposentinel;

-- Health scores over time
CREATE TABLE IF NOT EXISTS health_scores (
    timestamp DateTime DEFAULT now(),
    repo_id String,
    repo_name String,
    security_score Float32,
    reliability_score Float32,
    performance_score Float32,
    maintainability_score Float32,
    test_coverage_score Float32,
    overall_score Float32,
    commit_sha String,
    campaign_id Nullable(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (repo_id, timestamp);

-- Code metrics per module
CREATE TABLE IF NOT EXISTS module_metrics (
    timestamp DateTime DEFAULT now(),
    repo_id String,
    module_path String,
    loc Int32,
    complexity Int32,
    churn_count Int32,
    author_count Int32,
    test_coverage Float32,
    security_issues Int32,
    performance_issues Int32
) ENGINE = MergeTree()
ORDER BY (repo_id, module_path, timestamp);

-- Campaign execution history
CREATE TABLE IF NOT EXISTS campaigns (
    id String,
    repo_id String,
    campaign_type String,
    status String,
    started_at DateTime,
    completed_at Nullable(DateTime),
    prs_opened Int32,
    prs_merged Int32,
    prs_rejected Int32,
    loc_added Int32,
    loc_removed Int32,
    security_delta Float32,
    performance_delta Float32
) ENGINE = ReplacingMergeTree()
ORDER BY (id, started_at);

-- Agent actions log
CREATE TABLE IF NOT EXISTS agent_actions (
    timestamp DateTime DEFAULT now(),
    repo_id String,
    agent_type String,
    action_type String,
    target_module String,
    status String,
    duration_ms Int32,
    tokens_used Int32,
    model_used String,
    outcome String
) ENGINE = MergeTree()
ORDER BY (repo_id, agent_type, timestamp);

-- PR outcomes for preference learning
CREATE TABLE IF NOT EXISTS pr_outcomes (
    pr_number Int32,
    repo_id String,
    campaign_id String,
    created_at DateTime,
    merged_at Nullable(DateTime),
    closed_at Nullable(DateTime),
    status String,  -- merged, closed, draft, open
    review_comments Int32,
    commits_count Int32,
    files_changed Int32,
    additions Int32,
    deletions Int32,
    acceptance_signal Float32  -- ML feature for preference model
) ENGINE = ReplacingMergeTree()
ORDER BY (repo_id, pr_number);

-- Create materialized view for health trends (last 30 days)
CREATE MATERIALIZED VIEW IF NOT EXISTS health_trends_30d
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (repo_id, day)
AS SELECT
    toStartOfDay(timestamp) AS day,
    repo_id,
    repo_name,
    avg(security_score) AS avg_security,
    avg(reliability_score) AS avg_reliability,
    avg(performance_score) AS avg_performance,
    avg(maintainability_score) AS avg_maintainability,
    avg(test_coverage_score) AS avg_coverage,
    avg(overall_score) AS avg_overall
FROM health_scores
GROUP BY day, repo_id, repo_name;

-- Create projection for fast latest scores lookup
ALTER TABLE health_scores ADD PROJECTION IF NOT EXISTS latest_by_repo (
    SELECT *
    ORDER BY repo_id, -timestamp
);
