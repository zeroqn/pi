import {
  isEmbeddingHostBusy2
} from "./index-9p40dgkm.js";
import {
  log2
} from "./index-f956htf3.js";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LocalEmbeddingProvider
} from "./index-yy0h7gp8.js";
import {
  isSynapseEmbeddingTruncated,
  SynapseEmbeddingProvider
} from "./index-7neahsnb.js";
import {
  OpenAICompatibleEmbeddingProvider,
  getProjectEmbeddingSnapshot2,
  embedBatchForProject2
} from "./index-9d4pnmrf.js";
import {
  saveEmbeddingIfHashMatches
} from "./index-yhzhdp3m.js";

// ../plugin/src/features/magic-context/memory/cosine-similarity.ts
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0;index < a.length; index++) {
    dotProduct += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ../plugin/src/features/magic-context/memory/embedding.ts
var DEFAULT_EMBEDDING_CONFIG = {
  provider: "local",
  model: DEFAULT_LOCAL_EMBEDDING_MODEL,
  local_runtime: "auto"
};
var embeddingConfig = DEFAULT_EMBEDDING_CONFIG;
var provider = null;
function createProvider(config) {
  if (config.provider === "off") {
    return null;
  }
  if (config.provider === "openai-compatible") {
    return new OpenAICompatibleEmbeddingProvider({
      endpoint: config.endpoint,
      model: config.model,
      apiKey: config.api_key,
      inputType: config.input_type,
      queryInputType: config.query_input_type,
      queryInstruction: config.query_instruction,
      documentPrefix: config.document_prefix,
      truncate: config.truncate,
      maxInputTokens: config.max_input_tokens
    });
  }
  if (config.provider === "local") {
    return new LocalEmbeddingProvider(config.model, config.max_input_tokens, config.local_dtype, config.local_runtime);
  }
  if (config.provider === "synapse") {
    const synapse = config;
    return new SynapseEmbeddingProvider({
      connectionFile: synapse.synapse_connection_file ?? "",
      projectRoot: "",
      session: "embedding",
      model: synapse.model,
      fingerprint: synapse.synapse_fingerprint,
      tableEpoch: synapse.synapse_table_epoch,
      dims: synapse.synapse_dims,
      recommendedBatch: synapse.synapse_recommended_batch,
      recommendedTokenBudget: synapse.synapse_recommended_token_budget,
      descriptor: synapse.synapse_descriptor,
      provenance: synapse.synapse_provenance
    });
  }
  throw new Error("Unknown embedding provider");
}
function getOrCreateProvider() {
  if (provider) {
    return provider;
  }
  provider = createProvider(embeddingConfig);
  return provider;
}
function isEmbeddingEnabled() {
  return embeddingConfig.provider !== "off";
}
async function embedText(text, signal) {
  const currentProvider = getOrCreateProvider();
  if (!currentProvider) {
    return null;
  }
  if (!await currentProvider.initialize()) {
    return null;
  }
  const vector = await currentProvider.embed(text, signal);
  return vector && !isSynapseEmbeddingTruncated(vector) ? vector : null;
}

// ../plugin/src/features/magic-context/memory/embedding-backfill.ts
async function ensureMemoryEmbeddings2(args) {
  if (isEmbeddingHostBusy2())
    return args.existingEmbeddings;
  const snapshot = getProjectEmbeddingSnapshot2(args.projectIdentity);
  if (!snapshot?.enabled) {
    return args.existingEmbeddings;
  }
  const missingMemories = args.memories.filter((memory) => !args.existingEmbeddings.has(memory.id));
  if (missingMemories.length === 0) {
    return args.existingEmbeddings;
  }
  try {
    const result = await embedBatchForProject2(args.projectIdentity, missingMemories.map((memory) => memory.content));
    if (!result) {
      return args.existingEmbeddings;
    }
    const staged = new Map;
    args.db.transaction(() => {
      for (const [index, memory] of missingMemories.entries()) {
        const embedding = result.vectors[index];
        if (!embedding) {
          continue;
        }
        const saved = saveEmbeddingIfHashMatches(args.db, memory.id, embedding, result.modelId, memory.normalizedHash);
        if (saved) {
          staged.set(memory.id, { embedding, modelId: result.modelId });
        }
      }
    }).immediate();
    const currentSnapshot = getProjectEmbeddingSnapshot2(args.projectIdentity);
    if (!currentSnapshot || currentSnapshot.generation !== result.generation) {
      return args.existingEmbeddings;
    }
    for (const [id, embedding] of staged) {
      args.existingEmbeddings.set(id, embedding);
    }
  } catch (error) {
    log2("[magic-context] failed to backfill memory embeddings:", error);
  }
  return args.existingEmbeddings;
}

export { cosineSimilarity, isEmbeddingEnabled, embedText, ensureMemoryEmbeddings2 };
