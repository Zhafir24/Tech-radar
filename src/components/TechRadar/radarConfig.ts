import type { BlipDefinition, RadarConfig, ResolvedBlip } from "./types";
import { assignBlipPositions } from "./utils/scatter";
import { polarToCartesian } from "./utils/polar";

/**
 * Default radar configuration.
 *
 * Geometry uses a 1536 × 1024 viewBox with the radar centered at (768, 500)
 * and an outer ring radius of 440. Blips have no manual coordinates — they
 * are placed automatically by the scatter algorithm within each
 * (quadrant × ring) segment.
 */
export const DEFAULT_RADAR_CONFIG: RadarConfig = {
  viewBox: { width: 1536, height: 1024 },
  center: { x: 768, y: 500 },
  outerRadius: 440,
  background: "#FFFFFF",
  textColor: "#1F2A44",

  axis: {
    // Very subtle crosshair — solid thin light gray, Zalando-style.
    color: "#E5E7EB",
    strokeWidth: 1,
    dashArray: "",
  },

  blipStyle: {
    radius: 11,
    borderWidth: 1.25,
    hitRadius: 22,
    numberFontSize: 14,
  },

  scatter: {
    angleMargin: 5,
    radiusMargin: 0.025,
    minSpacing: 40,
    relaxationIterations: 180,
  },

  /*
   * Ring bands rebalanced so ADOPT (which carries the most blips: 35
   * across four quadrants) has the widest radial band. Ratios:
   * ADOPT 34% · TRIAL 56% · ASSESS 78% · EMERGING 100% of outerRadius.
   */
  rings: [
    {
      id: "adopt",
      label: "ADOPT",
      radius: 150,
      labelRadius: 112,
      colors: { ring: "#4ED17E", label: "#10B981", blip: "#22C55E" },
    },
    {
      id: "trial",
      label: "TRIAL",
      radius: 248,
      labelRadius: 205,
      colors: { ring: "#5B9CF6", label: "#2F80ED", blip: "#3B82F6" },
    },
    {
      id: "assess",
      label: "ASSESS",
      radius: 344,
      labelRadius: 305,
      colors: { ring: "#F6AD37", label: "#F59E0B", blip: "#F59E0B" },
    },
    {
      id: "emerging",
      label: "EMERGING",
      radius: 440,
      labelRadius: 403,
      colors: { ring: "#9C6FE4", label: "#7C3AED", blip: "#8B5CF6" },
    },
  ],

  /*
   * Angle ranges: 0° at 12 o'clock, clockwise.
   *  - Infrastructure (top-left)     : 270°–360°
   *  - AI & Automation (top-right)   :   0°–90°
   *  - Data & Integration (bottom-right): 90°–180°
   *  - Security (bottom-left)        : 180°–270°
   */
  quadrants: [
    {
      id: "infrastructure",
      label: "Infrastructure",
      icon: "server",
      angleRange: { min: 270, max: 360 },
    },
    {
      id: "ai-automation",
      label: "AI & Automation",
      icon: "ai",
      angleRange: { min: 0, max: 90 },
    },
    {
      id: "data-integration",
      label: "Data & Integration",
      icon: "database",
      angleRange: { min: 90, max: 180 },
    },
    {
      id: "security",
      label: "Security",
      icon: "shield",
      angleRange: { min: 180, max: 270 },
    },
  ],

  blips: [
    // ── INFRASTRUCTURE (1–24) ─────────────────────────────────────────────
    // ADOPT
    { id: "aws-s3", number: 1, name: "AWS S3", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    { id: "amazon-ec2", number: 2, name: "Amazon EC2", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    { id: "kubernetes", number: 3, name: "Kubernetes", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    { id: "docker", number: 4, name: "Docker", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    { id: "terraform", number: 5, name: "Terraform", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    { id: "nginx", number: 6, name: "Nginx", ring: "adopt", quadrant: "infrastructure", status: "no-change" },
    // TRIAL
    { id: "aws-lambda", number: 7, name: "AWS Lambda", ring: "trial", quadrant: "infrastructure", status: "no-change" },
    { id: "aws-fargate", number: 8, name: "AWS Fargate", ring: "trial", quadrant: "infrastructure", status: "no-change" },
    { id: "gce", number: 9, name: "Google Compute Engine", ring: "trial", quadrant: "infrastructure", status: "no-change" },
    { id: "azure-container-apps", number: 10, name: "Azure Container Apps", ring: "trial", quadrant: "infrastructure", status: "no-change" },
    { id: "hashicorp-consul", number: 11, name: "HashiCorp Consul", ring: "trial", quadrant: "infrastructure", status: "no-change" },
    // ASSESS
    { id: "aws-memorydb", number: 12, name: "AWS MemoryDB", ring: "assess", quadrant: "infrastructure", status: "no-change" },
    { id: "varnish", number: 13, name: "Varnish", ring: "assess", quadrant: "infrastructure", status: "no-change" },
    // EMERGING
    { id: "apache-cassandra", number: 14, name: "Apache Cassandra", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "cloudflare-workers", number: 15, name: "Cloudflare Workers", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "hazelcast", number: 16, name: "Hazelcast", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "cockroachdb", number: 17, name: "CockroachDB", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "scylladb", number: 18, name: "ScyllaDB", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "apache-pulsar", number: 19, name: "Apache Pulsar", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "clickhouse", number: 20, name: "ClickHouse", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "yugabytedb", number: 21, name: "YugabyteDB", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "oracle-exadata", number: 22, name: "Oracle Exadata", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "snowflake", number: 23, name: "Snowflake", ring: "emerging", quadrant: "infrastructure", status: "no-change" },
    { id: "otel-collector", number: 24, name: "OpenTelemetry Collector", ring: "emerging", quadrant: "infrastructure", status: "no-change" },

    // ── AI & AUTOMATION (25–43) ───────────────────────────────────────────
    // ADOPT
    { id: "apache-airflow", number: 25, name: "Apache Airflow", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "mlflow", number: 26, name: "MLflow", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "aws-sagemaker", number: 27, name: "AWS SageMaker", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "openai-api", number: 28, name: "OpenAI API", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "langchain", number: 29, name: "LangChain", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "databricks", number: 30, name: "Databricks", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "apache-flink", number: 31, name: "Apache Flink", ring: "adopt", quadrant: "ai-automation", status: "moved-up" },
    { id: "kafka", number: 32, name: "Kafka", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "nakadi", number: 33, name: "Nakadi", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    { id: "apache-spark", number: 34, name: "Apache Spark", ring: "adopt", quadrant: "ai-automation", status: "no-change" },
    // TRIAL
    { id: "amazon-translate", number: 35, name: "Amazon Translate", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    { id: "aws-athena", number: 36, name: "AWS Athena", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    { id: "dbt", number: 37, name: "dbt", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    { id: "google-bigquery", number: 38, name: "Google BigQuery", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    { id: "presto", number: 39, name: "Presto", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    { id: "rabbitmq", number: 40, name: "RabbitMQ", ring: "trial", quadrant: "ai-automation", status: "no-change" },
    // ASSESS
    { id: "aws-glue", number: 41, name: "AWS Glue", ring: "assess", quadrant: "ai-automation", status: "no-change" },
    { id: "aws-lake-formation", number: 42, name: "AWS Lake Formation", ring: "assess", quadrant: "ai-automation", status: "no-change" },
    { id: "streamlit", number: 43, name: "Streamlit", ring: "assess", quadrant: "ai-automation", status: "no-change" },

    // ── SECURITY (44–66) ──────────────────────────────────────────────────
    // ADOPT
    { id: "aws-iam", number: 44, name: "AWS IAM", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "aws-waf", number: 45, name: "AWS WAF", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "aws-shield", number: 46, name: "AWS Shield", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "aws-secrets-manager", number: 47, name: "AWS Secrets Manager", ring: "adopt", quadrant: "security", status: "moved-up" },
    { id: "vault", number: 48, name: "Vault", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "kubernetes-rbac", number: 49, name: "Kubernetes RBAC", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "snyk", number: 50, name: "Snyk", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "trivy", number: 51, name: "Trivy", ring: "adopt", quadrant: "security", status: "no-change" },
    { id: "falco", number: 52, name: "Falco", ring: "adopt", quadrant: "security", status: "no-change" },
    // TRIAL
    { id: "aws-security-hub", number: 53, name: "AWS Security Hub", ring: "trial", quadrant: "security", status: "new" },
    { id: "aqua-security", number: 54, name: "Aqua Security", ring: "trial", quadrant: "security", status: "moved-up" },
    { id: "opa", number: 55, name: "OPA (Open Policy Agent)", ring: "trial", quadrant: "security", status: "no-change" },
    { id: "aws-guardduty", number: 56, name: "AWS GuardDuty", ring: "trial", quadrant: "security", status: "no-change" },
    { id: "prisma-cloud", number: 57, name: "Prisma Cloud", ring: "trial", quadrant: "security", status: "no-change" },
    { id: "wiz", number: 58, name: "Wiz", ring: "trial", quadrant: "security", status: "no-change" },
    { id: "teleport", number: 59, name: "Teleport", ring: "trial", quadrant: "security", status: "new" },
    { id: "hashicorp-boundary", number: 60, name: "HashiCorp Boundary", ring: "trial", quadrant: "security", status: "no-change" },
    { id: "osquery", number: 61, name: "OSQuery", ring: "trial", quadrant: "security", status: "no-change" },
    // ASSESS
    { id: "aws-service-catalog", number: 62, name: "AWS Service Catalog", ring: "assess", quadrant: "security", status: "no-change" },
    { id: "okta", number: 63, name: "Okta", ring: "assess", quadrant: "security", status: "no-change" },
    { id: "crowdstrike", number: 64, name: "CrowdStrike", ring: "assess", quadrant: "security", status: "no-change" },
    { id: "datadog", number: 65, name: "Datadog", ring: "assess", quadrant: "security", status: "no-change" },
    { id: "graalvm", number: 66, name: "GraalVM", ring: "assess", quadrant: "security", status: "no-change" },

    // ── DATA & INTEGRATION (67–81) ────────────────────────────────────────
    // ADOPT
    { id: "go", number: 67, name: "Go", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "graphql", number: 68, name: "GraphQL", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "java", number: 69, name: "Java", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "javascript", number: 70, name: "JavaScript", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "kotlin", number: 71, name: "Kotlin", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "openapi", number: 72, name: "OpenAPI (Swagger)", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "python", number: 73, name: "Python", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "scala", number: 74, name: "Scala", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "swift", number: 75, name: "Swift", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    { id: "typescript", number: 76, name: "TypeScript", ring: "adopt", quadrant: "data-integration", status: "no-change" },
    // TRIAL
    { id: "dart", number: 77, name: "Dart", ring: "trial", quadrant: "data-integration", status: "no-change" },
    // ASSESS
    { id: "r", number: 78, name: "R", ring: "assess", quadrant: "data-integration", status: "no-change" },
    // EMERGING
    { id: "clojure", number: 79, name: "Clojure", ring: "emerging", quadrant: "data-integration", status: "no-change" },
    { id: "haskell", number: 80, name: "Haskell", ring: "emerging", quadrant: "data-integration", status: "no-change" },
    { id: "rust", number: 81, name: "Rust", ring: "emerging", quadrant: "data-integration", status: "no-change" },
  ],
};

/**
 * Resolve every blip's polar position to Cartesian coordinates and attach
 * ring/quadrant display metadata. Pure function of the config — call once
 * (memoized by the caller) per config instance.
 */
export function resolveBlips(config: RadarConfig): ResolvedBlip[] {
  const ringById = new Map(config.rings.map((ring) => [ring.id, ring]));
  const quadrantById = new Map(config.quadrants.map((q) => [q.id, q]));

  // Positions may already be manually set on individual blips; the scatter
  // algorithm only fills in the missing ones.
  const positioned = assignBlipPositions(config);

  return positioned.map((blip) => {
    const ring = ringById.get(blip.ring);
    const quadrant = quadrantById.get(blip.quadrant);
    if (!ring || !quadrant) {
      throw new Error(
        `Blip "${blip.id}" references unknown ring "${blip.ring}" or quadrant "${blip.quadrant}"`,
      );
    }
    const angle = blip.angle ?? 0;
    const radiusFraction = blip.radiusFraction ?? 0;
    const { x, y } = polarToCartesian(
      config.center.x,
      config.center.y,
      radiusFraction * config.outerRadius,
      angle,
    );
    return {
      ...blip,
      angle,
      radiusFraction,
      hidden: blip.hidden ?? false,
      since: blip.since ?? "",
      updatedAt: blip.updatedAt ?? "",
      owner: blip.owner ?? "",
      x,
      y,
      color: ring.colors.blip,
      ringLabel: ring.label,
      quadrantLabel: quadrant.label,
    };
  });
}

/**
 * Filter blips by quadrant, then group by ring in ADOPT → EMERGING order.
 * Used by the corner legend panels.
 */
export function blipsByRingForQuadrant(
  config: RadarConfig,
  quadrantId: string,
): Array<{ ringId: string; ringLabel: string; blips: BlipDefinition[] }> {
  const ringOrder: Array<RadarConfig["rings"][number]["id"]> = [
    "adopt",
    "trial",
    "assess",
    "emerging",
  ];
  return ringOrder.map((ringId) => {
    const ring = config.rings.find((r) => r.id === ringId)!;
    return {
      ringId,
      ringLabel: ring.label,
      blips: config.blips
        .filter((b) => b.quadrant === quadrantId && b.ring === ringId && !b.hidden)
        .sort((a, b) => a.number - b.number),
    };
  });
}
